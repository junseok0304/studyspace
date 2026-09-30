package kr.omong.studyspace.study;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.apache.poi.poifs.filesystem.POIFSFileSystem;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertTrue;

class AttachmentAnalyzerTests {
    @Test void extractsPdfTextWithPageLocation() throws Exception {
        var bytes=new ByteArrayOutputStream();
        try(var document=new PDDocument()) {
            var page=new PDPage(); document.addPage(page);
            try(var content=new PDPageContentStream(document,page)) {
                content.beginText();
                content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA),12);
                content.newLineAtOffset(72,720);
                content.showText("Operating systems and processes");
                content.endText();
            }
            document.save(bytes);
        }
        String text=AttachmentAnalyzer.extract(new ByteArrayInputStream(bytes.toByteArray()),"pdf");
        assertTrue(text.contains("PDF 페이지 1"));
        assertTrue(text.contains("Operating systems and processes"));
    }

    @Test void extractsPptxTextInSlideOrderWithoutExternalEntities() throws Exception {
        var bytes=new ByteArrayOutputStream();
        try(var zip=new ZipOutputStream(bytes)) {
            slide(zip,2,"Second slide");
            slide(zip,1,"First slide");
        }
        String text=AttachmentAnalyzer.extract(new ByteArrayInputStream(bytes.toByteArray()),"pptx");
        assertTrue(text.indexOf("First slide") < text.indexOf("Second slide"));
        assertTrue(text.contains("슬라이드 1"));
    }

    @Test void extractsCompressedHwpFiveParagraphText() throws Exception {
        var bytes=new ByteArrayOutputStream();
        try(var filesystem=new POIFSFileSystem()) {
            byte[] header=new byte[256];
            byte[] signature="HWP Document File".getBytes(StandardCharsets.US_ASCII);
            System.arraycopy(signature,0,header,0,signature.length);
            ByteBuffer.wrap(header,36,4).order(ByteOrder.LITTLE_ENDIAN).putInt(1);
            filesystem.getRoot().createDocument("FileHeader",new ByteArrayInputStream(header));
            var body=filesystem.getRoot().createDirectory("BodyText");
            byte[] text="운영체제 프로세스와 스레드".getBytes(StandardCharsets.UTF_16LE);
            var record=new ByteArrayOutputStream();
            record.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(67|(text.length<<20)).array());
            record.write(text);
            var compressed=new ByteArrayOutputStream();
            try(var output=new DeflaterOutputStream(compressed,new Deflater(Deflater.DEFAULT_COMPRESSION,true))) { output.write(record.toByteArray()); }
            body.createDocument("Section0",new ByteArrayInputStream(compressed.toByteArray()));
            filesystem.writeFilesystem(bytes);
        }
        String extracted=AttachmentAnalyzer.extract(new ByteArrayInputStream(bytes.toByteArray()),"hwp");
        assertTrue(extracted.contains("HWP 구역 1"));
        assertTrue(extracted.contains("운영체제 프로세스와 스레드"));
    }

    private static void slide(ZipOutputStream zip,int number,String text) throws Exception {
        zip.putNextEntry(new ZipEntry("ppt/slides/slide"+number+".xml"));
        zip.write(("<p:sld xmlns:p=\"urn:p\" xmlns:a=\"urn:a\"><a:t>"+text+"</a:t></p:sld>").getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }
}
