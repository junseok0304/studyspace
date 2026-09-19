package kr.omong.studyspace.study;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class SchoolVault {
    private final byte[] key;
    public SchoolVault(@Value("${STUDYSPACE_SCHOOL_KEY:}") String configured,
                       @Value("${STUDYSPACE_SCHOOL_KEY_FILE:runtime/school-key}") String keyFile) throws Exception {
        if (!configured.isBlank()) key = Base64.getDecoder().decode(configured);
        else {
            Path path = Path.of(keyFile);
            Files.createDirectories(path.toAbsolutePath().getParent());
            if (!Files.exists(path)) {
                byte[] generated = new byte[32]; new SecureRandom().nextBytes(generated);
                try {
                    Files.createFile(path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
                    Files.write(path, generated);
                } catch (FileAlreadyExistsException ignored) { }
            }
            key = Files.readAllBytes(path);
        }
        if (key.length != 32) throw new IllegalStateException("학교 연동 저장 키 설정을 확인해 주세요.");
    }
    public String encrypt(long user, String plain) throws Exception {
        byte[] nonce = new byte[12]; new SecureRandom().nextBytes(nonce);
        Cipher cipher = cipher(Cipher.ENCRYPT_MODE,user,nonce);
        return Base64.getEncoder().encodeToString(nonce) + "." + Base64.getEncoder().encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)));
    }
    public String decrypt(long user, String stored) throws Exception {
        String[] parts = stored.split("\\.");
        return new String(cipher(Cipher.DECRYPT_MODE,user,Base64.getDecoder().decode(parts[0])).doFinal(Base64.getDecoder().decode(parts[1])),StandardCharsets.UTF_8);
    }
    private Cipher cipher(int mode, long user, byte[] nonce) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,nonce));
        c.updateAAD(Long.toString(user).getBytes(StandardCharsets.UTF_8)); return c;
    }
}
