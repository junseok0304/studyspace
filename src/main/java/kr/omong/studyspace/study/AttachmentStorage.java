package kr.omong.studyspace.study;

import kr.omong.studyspace.auth.AuthException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.*;
import java.nio.file.*;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

@Component
public class AttachmentStorage {
    static final long MAX_BYTES = 50L * 1024 * 1024;
    private static final Set<String> EXTENSIONS = Set.of("pdf", "pptx", "hwp", "png");
    private final Path root;

    public AttachmentStorage(@Value("${STUDYSPACE_UPLOAD_DIR:./runtime/uploads}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    public record Stored(String storageKey, String mediaType, String extension, long size, String sha256) {}

    public Stored store(long userId, String attachmentId, MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) throw new AuthException("첨부할 파일을 선택해 주세요.", 400);
        if (file.getSize() > MAX_BYTES) throw new AuthException("파일은 50MB 이하만 첨부할 수 있습니다.", 413);
        String original = safeName(file.getOriginalFilename());
        String extension = extension(original);
        if (!EXTENSIONS.contains(extension)) throw new AuthException("PDF, PPTX, HWP, PNG 파일만 첨부할 수 있습니다.", 415);
        String mediaType = mediaType(extension);
        Path userDir = root.resolve(Long.toString(userId)).normalize();
        if (!userDir.startsWith(root)) throw new AuthException("첨부 저장 경로가 올바르지 않습니다.", 400);
        Files.createDirectories(userDir);
        Path temp = userDir.resolve(attachmentId + ".uploading").normalize();
        Path target = userDir.resolve(attachmentId + "." + extension).normalize();
        if (!temp.startsWith(userDir) || !target.startsWith(userDir)) throw new AuthException("첨부 저장 경로가 올바르지 않습니다.", 400);
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (Exception e) { throw new IOException("파일 해시를 계산하지 못했습니다.", e); }
        long size = 0;
        try (InputStream source = file.getInputStream(); DigestInputStream input = new DigestInputStream(source, digest);
             OutputStream output = Files.newOutputStream(temp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) {
                size += read;
                if (size > MAX_BYTES) throw new AuthException("파일은 50MB 이하만 첨부할 수 있습니다.", 413);
                output.write(buffer, 0, read);
            }
        } catch (Exception error) {
            Files.deleteIfExists(temp);
            if (error instanceof AuthException auth) throw auth;
            if (error instanceof IOException io) throw io;
            throw new IOException("파일을 저장하지 못했습니다.", error);
        }
        try {
            validateContent(temp, extension);
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(temp, target);
        } catch (Exception error) {
            Files.deleteIfExists(temp);
            if (error instanceof AuthException auth) throw auth;
            if (error instanceof IOException io) throw io;
            throw new IOException("첨부 형식을 확인하지 못했습니다.", error);
        }
        return new Stored(userId + "/" + attachmentId + "." + extension, mediaType, extension, size, hex(digest.digest()));
    }

    public InputStream open(String storageKey) throws IOException {
        Path path = resolve(storageKey);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new FileNotFoundException("첨부 파일이 없습니다.");
        return Files.newInputStream(path, StandardOpenOption.READ);
    }

    public void delete(String storageKey) throws IOException { Files.deleteIfExists(resolve(storageKey)); }

    private Path resolve(String storageKey) {
        if (storageKey == null || storageKey.isBlank() || storageKey.contains("\\") || storageKey.contains(".."))
            throw new AuthException("첨부 경로가 올바르지 않습니다.", 400);
        Path path = root.resolve(storageKey).normalize();
        if (!path.startsWith(root)) throw new AuthException("첨부 경로가 올바르지 않습니다.", 400);
        return path;
    }

    private static void validateContent(Path file, String extension) throws IOException {
        try (InputStream input = Files.newInputStream(file)) {
            byte[] header = input.readNBytes(16);
            boolean valid = switch (extension) {
                case "pdf" -> startsWith(header, new byte[]{'%', 'P', 'D', 'F', '-'});
                case "png" -> startsWith(header, new byte[]{(byte)0x89,'P','N','G',0x0D,0x0A,0x1A,0x0A});
                case "hwp" -> startsWith(header, new byte[]{(byte)0xD0,(byte)0xCF,0x11,(byte)0xE0,(byte)0xA1,(byte)0xB1,0x1A,(byte)0xE1});
                case "pptx" -> zipLooksLikePresentation(file);
                default -> false;
            };
            if (!valid) throw new AuthException("파일 확장자와 실제 파일 형식이 일치하지 않습니다.", 415);
        }
    }

    private static boolean zipLooksLikePresentation(Path file) throws IOException {
        boolean presentation = false; long uncompressed = 0;
        try (ZipFile zip = new ZipFile(file.toFile())) {
            var entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement(); String name = entry.getName();
                if (name.startsWith("/") || name.contains("../") || name.contains("..\\")) throw new AuthException("안전하지 않은 PPTX 구조입니다.", 415);
                if (name.equals("[Content_Types].xml") || name.equals("ppt/presentation.xml")) presentation = true;
                if (entry.getSize() > 0) { uncompressed += entry.getSize(); if (uncompressed > 100L * 1024 * 1024) throw new AuthException("압축 해제 후 파일이 너무 큽니다.", 413); }
            }
        }
        return presentation;
    }

    private static boolean startsWith(byte[] value, byte[] prefix) {
        if (value.length < prefix.length) return false;
        for (int i=0;i<prefix.length;i++) if (value[i] != prefix[i]) return false;
        return true;
    }
    static String safeName(String value) {
        String raw = value == null ? "첨부파일" : value.replace('\\','/');
        String name = raw.substring(raw.lastIndexOf('/') + 1).strip();
        if (name.isBlank() || name.length() > 200 || name.equals(".") || name.equals("..") || name.indexOf('\0') >= 0 || name.chars().anyMatch(Character::isISOControl)) throw new AuthException("파일 이름을 확인해 주세요.",400);
        return name;
    }
    private static String extension(String name) { int dot=name.lastIndexOf('.'); return dot < 1 ? "" : name.substring(dot+1).toLowerCase(Locale.ROOT); }
    private static String mediaType(String ext) { return switch (ext) { case "pdf" -> "application/pdf"; case "pptx" -> "application/vnd.openxmlformats-officedocument.presentationml.presentation"; case "hwp" -> "application/x-hwp"; default -> "image/png"; }; }
    private static String hex(byte[] bytes) { StringBuilder value=new StringBuilder(bytes.length*2); for(byte b:bytes) value.append(String.format("%02x",b)); return value.toString(); }
}
