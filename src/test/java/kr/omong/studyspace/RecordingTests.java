package kr.omong.studyspace;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import kr.omong.studyspace.study.RecordingStorage;

import java.util.UUID;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class RecordingTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired RecordingStorage storage;

    @Test void createsMultipleRecordingsPerNoteButOnlyOneActivePerUser() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('recording@example.com','test','학생')");
        long ownerId=db.queryForObject("select id from users where email='recording@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('recording-course',?,'2026-2','강의')",ownerId);
        db.update("insert into courses(id,user_id,semester,name) values('recording-other-course',?,'2026-2','다른 강의')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-note','recording-course',?,'1주차','내용',1)",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-note-2','recording-course',?,'2주차','내용',1)",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-other-note','recording-other-course',?,'다른 주차','내용',1)",ownerId);
        var owner=user(Long.toString(ownerId)); String body="{\"title\":\"1주차 녹음\",\"mimeType\":\"audio/webm;codecs=opus\"}";
        mvc.perform(post("/api/notes/recording-note/recordings").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.status").value("RECORDING")).andExpect(jsonPath("$.noteId").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(post("/api/notes/recording-note/recordings").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isConflict());
        mvc.perform(get("/api/notes/recording-note/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].title").value("1주차 녹음"));
        mvc.perform(get("/api/notes/recording-note-2/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].courseId").value("recording-course"));
        mvc.perform(get("/api/courses/recording-course/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$[0].courseId").value("recording-course"));
        mvc.perform(get("/api/courses/recording-other-course/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        mvc.perform(get("/api/notes/recording-other-note/recordings").with(owner)).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        String id=db.queryForObject("select id from recordings where user_id=?",String.class,ownerId);
        mvc.perform(patch("/api/recordings/"+id+"/note").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"noteId\":\"recording-note-2\"}"))
                .andExpect(status().isConflict());
        mvc.perform(get("/api/notes/recording-note/recordings").with(user("999999"))).andExpect(status().isNotFound());
    }

    @Test void streamsOnlyTheRequestedAudioRange() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('range-recording@example.com','test','학생')");
        long ownerId=db.queryForObject("select id from users where email='range-recording@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('range-course',?,'2026-2','강의')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('range-note','range-course',?,'1주차','내용',1)",ownerId);
        String id=UUID.randomUUID().toString(); byte[] audio="0123456789".getBytes();
        storage.storeChunk(ownerId,id,0,new MockMultipartFile("chunk","chunk.webm","audio/webm",audio));
        var stored=storage.assemble(ownerId,id,1,"webm");
        db.update("insert into recordings(id,note_id,course_id,user_id,title,status,mime_type,storage_key,size_bytes,next_sequence,duration_seconds) values(?,'range-note','range-course',?,'녹음','READY','audio/webm',?,?,1,1)",id,ownerId,stored.storageKey(),stored.size());

        mvc.perform(get("/api/recordings/"+id+"/content").with(user(Long.toString(ownerId))).header("Range","bytes=2-5"))
                .andExpect(status().isPartialContent()).andExpect(header().string("Content-Range","bytes 2-5/10"))
                .andExpect(header().string("Accept-Ranges","bytes")).andExpect(content().bytes("2345".getBytes()));
        mvc.perform(get("/api/recordings/"+id+"/content").with(user(Long.toString(ownerId))).header("Range","bytes=20-30"))
                .andExpect(status().isRequestedRangeNotSatisfiable());
        storage.delete(ownerId,id);
    }

    @Test void savesWaveformAndEnforcesOneHourRecordingLimit() throws Exception {
        db.update("insert into users(email,password_hash,nickname) values('recording-limit@example.com','test','학생')");
        long ownerId=db.queryForObject("select id from users where email='recording-limit@example.com'",Long.class);
        db.update("insert into courses(id,user_id,semester,name) values('recording-limit-course',?,'2026-2','강의')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-limit-note','recording-limit-course',?,'1주차','내용',1)",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-limit-note-2','recording-limit-course',?,'2주차','내용',1)",ownerId);
        db.update("insert into courses(id,user_id,semester,name) values('recording-limit-other-course',?,'2026-2','다른 강의')",ownerId);
        db.update("insert into notes(id,course_id,user_id,title,body,version) values('recording-limit-other-note','recording-limit-other-course',?,'다른 강의 노트','내용',1)",ownerId);
        var owner=user(Long.toString(ownerId));
        mvc.perform(post("/api/notes/recording-limit-note/recordings").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"한 시간 녹음\",\"mimeType\":\"audio/webm\"}"))
                .andExpect(status().isCreated());
        String id=db.queryForObject("select id from recordings where user_id=?",String.class,ownerId);
        byte[] chunkBytes="audio".getBytes();
        mvc.perform(multipart("/api/recordings/"+id+"/chunks").file(new MockMultipartFile("chunk","chunk.webm","audio/webm",chunkBytes))
                        .param("sequence","0").with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.nextSequence").value(1));
        mvc.perform(multipart("/api/recordings/"+id+"/chunks").file(new MockMultipartFile("chunk","chunk.webm","audio/webm",chunkBytes))
                        .param("sequence","0").with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.duplicate").value(true)).andExpect(jsonPath("$.nextSequence").value(1));
        mvc.perform(multipart("/api/recordings/"+id+"/chunks").file(new MockMultipartFile("chunk","chunk.webm","audio/webm","different".getBytes()))
                        .param("sequence","0").with(owner).with(csrf()))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/recordings/"+id+"/heartbeat").with(owner).with(csrf()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true));
        mvc.perform(post("/api/recordings/"+id+"/finish").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"durationSeconds\":3600.1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/recordings/"+id+"/finish").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"durationSeconds\":3600}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY")).andExpect(jsonPath("$.durationSeconds").value(3600));
        mvc.perform(post("/api/recordings/"+id+"/finish").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"durationSeconds\":3600}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY"));
        mvc.perform(post("/api/recordings/"+id+"/waveform").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"peaks\":[0.1,0.9,0.2]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.waveform.length()").value(3));
        mvc.perform(patch("/api/recordings/"+id+"/note").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"noteId\":\"recording-limit-note-2\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.noteId").value("recording-limit-note-2"));
        mvc.perform(get("/api/courses/recording-limit-course/recordings").with(owner))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].noteId").value("recording-limit-note-2"))
                .andExpect(jsonPath("$[0].noteTitle").value("2주차"));
        mvc.perform(patch("/api/recordings/"+id+"/note").with(owner).with(csrf()).contentType(MediaType.APPLICATION_JSON).content("{\"noteId\":\"recording-limit-other-note\"}"))
                .andExpect(status().isConflict());
        storage.delete(ownerId,id);
    }
}
