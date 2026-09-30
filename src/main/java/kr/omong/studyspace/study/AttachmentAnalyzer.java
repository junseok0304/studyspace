package kr.omong.studyspace.study;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.poifs.filesystem.DirectoryEntry;
import org.apache.poi.poifs.filesystem.DocumentEntry;
import org.apache.poi.poifs.filesystem.DocumentInputStream;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class AttachmentAnalyzer {
    private static final int MAX_TEXT = 200_000;
    private static final int MAX_PDF_PAGES = 300;
    private static final long MAX_UNCOMPRESSED = 100L * 1024 * 1024;

    private AttachmentAnalyzer() {}

    static String extract(InputStream input,String extension) throws Exception {
        return switch(extension) {
            case "pdf" -> pdf(input);
            case "pptx" -> pptx(input);
            case "hwp" -> hwp(input);
            default -> throw new IllegalArgumentException("지원하지 않는 텍스트 추출 형식입니다.");
        };
    }

    private static String hwp(InputStream input) throws Exception {
        try(var filesystem=new POIFSFileSystem(input)) {
            DirectoryEntry root=filesystem.getRoot();
            if(!root.hasEntry("FileHeader") || !root.hasEntry("BodyText")) throw new IllegalArgumentException("HWP 문서 구조가 아닙니다.");
            byte[] header=read((DocumentEntry)root.getEntry("FileHeader"),4096);
            String signature=new String(header,0,Math.min(32,header.length),StandardCharsets.US_ASCII);
            if(!signature.startsWith("HWP Document File")) throw new IllegalArgumentException("HWP 5.x 문서가 아닙니다.");
            boolean compressed=header.length>39 && (ByteBuffer.wrap(header,36,4).order(ByteOrder.LITTLE_ENDIAN).getInt()&1)!=0;
            DirectoryEntry body=(DirectoryEntry)root.getEntry("BodyText");
            var sections=new ArrayList<DocumentEntry>();
            for(var entries=body.getEntries();entries.hasNext();) {
                var entry=entries.next(); if(entry instanceof DocumentEntry document && entry.getName().startsWith("Section")) sections.add(document);
            }
            sections.sort(Comparator.comparingInt(entry->sectionNumber(entry.getName())));
            if(sections.isEmpty()) throw new IllegalArgumentException("HWP 본문 구역이 없습니다.");
            var result=new StringBuilder(); int section=0;
            for(DocumentEntry entry:sections) {
                byte[] bytes=read(entry,(int)Math.min(MAX_UNCOMPRESSED,Integer.MAX_VALUE));
                if(compressed) bytes=inflate(bytes);
                String text=hwpRecords(bytes);
                if(!text.isBlank()) append(result,"## HWP 구역 "+(++section)+"\n"+text.strip()+"\n\n");
            }
            if(result.isEmpty()) throw new IllegalArgumentException("HWP 본문 텍스트가 없습니다.");
            return result.toString().strip();
        }
    }

    private static byte[] read(DocumentEntry entry,int limit) throws Exception {
        if(entry.getSize()>limit) throw new IllegalArgumentException("문서 데이터 크기 초과");
        try(var stream=new DocumentInputStream(entry)) { return stream.readAllBytes(); }
    }

    private static byte[] inflate(byte[] source) throws Exception {
        try(var input=new InflaterInputStream(new ByteArrayInputStream(source),new Inflater(true));var output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192];int count,total=0;
            while((count=input.read(buffer))!=-1) { total+=count;if(total>MAX_UNCOMPRESSED)throw new IllegalArgumentException("압축 해제 크기 초과");output.write(buffer,0,count); }
            return output.toByteArray();
        }
    }

    private static String hwpRecords(byte[] data) {
        var result=new StringBuilder();int offset=0;
        while(offset+4<=data.length) {
            int record=ByteBuffer.wrap(data,offset,4).order(ByteOrder.LITTLE_ENDIAN).getInt();offset+=4;
            int tag=record&0x3ff;int size=(record>>>20)&0xfff;
            if(size==0xfff) { if(offset+4>data.length)break;size=ByteBuffer.wrap(data,offset,4).order(ByteOrder.LITTLE_ENDIAN).getInt();offset+=4; }
            if(size<0 || offset+size>data.length) break;
            if(tag==67 && size>=2) {
                String value=new String(data,offset,size-(size%2),StandardCharsets.UTF_16LE)
                        .replaceAll("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"," ").strip();
                if(!value.isBlank()) append(result,value+"\n");
            }
            offset+=size;
        }
        return result.toString();
    }

    private static int sectionNumber(String name) { try{return Integer.parseInt(name.substring("Section".length()));}catch(Exception ignored){return Integer.MAX_VALUE;} }

    private static String pdf(InputStream input) throws Exception {
        try(var source=new RandomAccessReadBuffer(input); var document=Loader.loadPDF(source)) {
            if(document.isEncrypted()) throw new IllegalArgumentException("암호화된 PDF입니다.");
            int pages=Math.min(document.getNumberOfPages(),MAX_PDF_PAGES);
            var stripper=new PDFTextStripper(); var result=new StringBuilder();
            for(int page=1;page<=pages;page++) {
                stripper.setStartPage(page); stripper.setEndPage(page);
                append(result,"## PDF 페이지 "+page+"\n"+stripper.getText(document).strip()+"\n\n");
            }
            if(document.getNumberOfPages()>MAX_PDF_PAGES) append(result,"[300페이지 이후 내용은 추출 범위에서 제외되었습니다.]\n");
            return result.toString().strip();
        }
    }

    private static String pptx(InputStream input) throws Exception {
        Map<Integer,String> slides=new TreeMap<>(); long total=0;
        try(var zip=new ZipInputStream(input)) {
            ZipEntry entry;
            while((entry=zip.getNextEntry())!=null) {
                long size=entry.getSize(); if(size>0 && (total+=size)>MAX_UNCOMPRESSED) throw new IllegalArgumentException("압축 해제 크기 초과");
                String name=entry.getName(); Integer number=slideNumber(name);
                if(number!=null) slides.put(number,slideText(zip));
            }
        }
        if(slides.isEmpty()) throw new IllegalArgumentException("슬라이드가 없습니다.");
        var result=new StringBuilder();
        for(var slide:slides.entrySet()) append(result,"## 슬라이드 "+slide.getKey()+"\n"+slide.getValue().strip()+"\n\n");
        return result.toString().strip();
    }

    private static Integer slideNumber(String name) {
        if(!name.startsWith("ppt/slides/slide") || !name.endsWith(".xml")) return null;
        String value=name.substring("ppt/slides/slide".length(),name.length()-4);
        try { return Integer.valueOf(value); } catch(NumberFormatException ignored) { return null; }
    }

    private static String slideText(InputStream input) throws Exception {
        XMLInputFactory factory=XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD,false);
        factory.setProperty("javax.xml.stream.isSupportingExternalEntities",false);
        InputStream entryStream=new FilterInputStream(input) { @Override public void close() {} };
        XMLStreamReader xml=factory.createXMLStreamReader(entryStream); var text=new StringBuilder();
        try {
            while(xml.hasNext()) {
                int event=xml.next();
                if(event==XMLStreamConstants.START_ELEMENT && xml.getLocalName().equals("t")) {
                    String value=xml.getElementText().strip(); if(!value.isEmpty()) append(text,value+"\n");
                }
            }
        } finally { xml.close(); }
        return text.toString();
    }

    private static void append(StringBuilder target,String value) {
        int remaining=MAX_TEXT-target.length();
        if(remaining<=0) return;
        target.append(value,0,Math.min(remaining,value.length()));
    }
}
