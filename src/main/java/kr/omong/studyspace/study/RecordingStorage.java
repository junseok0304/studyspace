package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.Comparator;

@Component
public class RecordingStorage {
    static final long MAX_CHUNK_BYTES=5L*1024*1024;
    static final long MAX_RECORDING_BYTES=600L*1024*1024;
    private final Path root;

    public RecordingStorage(@Value("${STUDYSPACE_RECORDING_DIR:./runtime/recordings}") String root) {
        this.root=Path.of(root).toAbsolutePath().normalize();
    }

    public record Chunk(long size,String sha256) {}
    public record FinalFile(String storageKey,long size) {}

    public boolean matchesChunk(MultipartFile file,long expectedSize,String expectedHash) throws Exception {
        if(file==null || file.isEmpty() || file.getSize()!=expectedSize || expectedSize>MAX_CHUNK_BYTES) return false;
        var digest=MessageDigest.getInstance("SHA-256");
        try(InputStream input=file.getInputStream()) {
            byte[] buffer=new byte[8192]; int read; long size=0;
            while((read=input.read(buffer))!=-1) {
                size+=read;
                if(size>MAX_CHUNK_BYTES) return false;
                digest.update(buffer,0,read);
            }
            return size==expectedSize && hex(digest.digest()).equals(expectedHash);
        }
    }

    public Chunk storeChunk(long userId,String recordingId,int sequence,MultipartFile file) throws Exception {
        if(file==null || file.isEmpty()) throw new AuthException("녹음 조각이 비어 있습니다.",400);
        if(file.getSize()>MAX_CHUNK_BYTES) throw new AuthException("녹음 조각이 너무 큽니다.",413);
        Path directory=directory(userId,recordingId); Files.createDirectories(directory);
        Path temp=directory.resolve(String.format("%06d.uploading",sequence));
        Path target=directory.resolve(String.format("%06d.part",sequence));
        var digest=MessageDigest.getInstance("SHA-256"); long size=0;
        try(InputStream input=file.getInputStream(); OutputStream output=Files.newOutputStream(temp,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING)) {
            byte[] buffer=new byte[8192]; int read;
            while((read=input.read(buffer))!=-1) {
                size+=read; if(size>MAX_CHUNK_BYTES) throw new AuthException("녹음 조각이 너무 큽니다.",413);
                digest.update(buffer,0,read); output.write(buffer,0,read);
            }
        } catch(Exception error) { Files.deleteIfExists(temp); throw error; }
        try {
            try { Files.move(temp,target,StandardCopyOption.ATOMIC_MOVE); }
            catch(java.nio.file.AtomicMoveNotSupportedException ignored) { Files.move(temp,target); }
        } catch(Exception error) { Files.deleteIfExists(temp); throw error; }
        return new Chunk(size,hex(digest.digest()));
    }

    public FinalFile assemble(long userId,String recordingId,int chunks,String extension) throws Exception {
        Path directory=directory(userId,recordingId); Path target=directory.resolve("audio."+extension); long size=0;
        try(OutputStream output=Files.newOutputStream(target,StandardOpenOption.CREATE,StandardOpenOption.TRUNCATE_EXISTING)) {
            for(int sequence=0;sequence<chunks;sequence++) {
                Path part=directory.resolve(String.format("%06d.part",sequence));
                if(!Files.isRegularFile(part)) throw new AuthException("녹음 일부가 저장되지 않았습니다.",409);
                size+=Files.size(part); if(size>MAX_RECORDING_BYTES) throw new AuthException("녹음 파일 용량 한도를 초과했습니다.",413);
                Files.copy(part,output);
            }
        } catch(Exception error) { Files.deleteIfExists(target); throw error; }
        return new FinalFile(userId+"/"+recordingId+"/audio."+extension,size);
    }

    public FileSystemResource resource(String storageKey) {
        Path path=resolve(storageKey);
        if(!Files.isRegularFile(path)) throw new AuthException("녹음 파일을 찾을 수 없습니다.",410);
        return new FileSystemResource(path);
    }

    public void delete(long userId,String recordingId) throws Exception {
        Path directory=directory(userId,recordingId);
        if(!Files.exists(directory)) return;
        try(var paths=Files.walk(directory)) {
            for(Path path:paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
        }
    }

    public void deleteChunk(long userId,String recordingId,int sequence) throws Exception {
        Files.deleteIfExists(directory(userId,recordingId).resolve(String.format("%06d.part",sequence)));
    }

    private Path directory(long userId,String recordingId) {
        if(!recordingId.matches("[a-fA-F0-9-]{36}")) throw new AuthException("녹음 경로가 올바르지 않습니다.",400);
        Path directory=root.resolve(Long.toString(userId)).resolve(recordingId).normalize();
        if(!directory.startsWith(root)) throw new AuthException("녹음 경로가 올바르지 않습니다.",400);
        return directory;
    }
    private Path resolve(String key) {
        if(key==null || key.contains("..") || key.contains("\\")) throw new AuthException("녹음 경로가 올바르지 않습니다.",400);
        Path path=root.resolve(key).normalize(); if(!path.startsWith(root)) throw new AuthException("녹음 경로가 올바르지 않습니다.",400); return path;
    }
    private static String hex(byte[] bytes) { var value=new StringBuilder(); for(byte item:bytes)value.append(String.format("%02x",item)); return value.toString(); }
}
