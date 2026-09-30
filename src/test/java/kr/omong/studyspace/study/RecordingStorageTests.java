package kr.omong.studyspace.study;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

class RecordingStorageTests {
    @TempDir Path directory;

    @Test void storesOrderedChunksAndAssemblesAudio() throws Exception {
        var storage=new RecordingStorage(directory.toString()); String id=UUID.randomUUID().toString();
        var first=storage.storeChunk(7,id,0,new MockMultipartFile("chunk","first.webm","audio/webm",new byte[]{1,2,3}));
        var second=storage.storeChunk(7,id,1,new MockMultipartFile("chunk","second.webm","audio/webm",new byte[]{4,5}));
        assertEquals(3,first.size()); assertEquals(2,second.size());
        var result=storage.assemble(7,id,2,"webm");
        assertArrayEquals(new byte[]{1,2,3,4,5},Files.readAllBytes(directory.resolve(result.storageKey())));
        storage.delete(7,id);
    }
}
