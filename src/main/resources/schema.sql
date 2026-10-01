create table if not exists users (
    id bigint auto_increment primary key,
    email varchar(254) not null unique,
    password_hash varchar(255) not null,
    nickname varchar(50) not null,
    email_verified boolean not null default false,
    onboarding_completed boolean not null default false,
    created_at timestamp not null default current_timestamp
);

create table if not exists school_links (
    user_id bigint primary key,
    credentials text not null,
    linked boolean not null default false,
    preview text,
    imported_at timestamp,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists user_consents (
    user_id bigint primary key,
    terms_version varchar(40) not null,
    privacy_version varchar(40) not null,
    accepted_at timestamp not null default current_timestamp,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists courses (
    id varchar(36) primary key,
    user_id bigint not null,
    semester varchar(40) not null,
    name varchar(120) not null,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists semesters (
    user_id bigint not null,
    name varchar(40) not null,
    created_at timestamp not null default current_timestamp,
    primary key (user_id, name),
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists course_settings (
    course_id varchar(36) primary key,
    user_id bigint not null,
    archived boolean not null default false,
    foreign key (course_id) references courses(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists notes (
    id varchar(36) primary key,
    course_id varchar(36) not null,
    user_id bigint not null,
    title varchar(200) not null,
    body text not null,
    version bigint not null default 0,
    updated_at timestamp not null default current_timestamp,
    foreign key (course_id) references courses(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists note_trash (
    note_id varchar(36) primary key,
    user_id bigint not null,
    deleted_at timestamp not null default current_timestamp,
    foreign key (note_id) references notes(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
);

create table if not exists attachments (
    id varchar(36) primary key,
    note_id varchar(36) not null,
    user_id bigint not null,
    original_name varchar(200) not null,
    storage_key varchar(300) not null unique,
    media_type varchar(100) not null,
    extension varchar(10) not null,
    size_bytes bigint not null,
    sha256 varchar(64) not null,
    analysis_status varchar(30) not null default 'NOT_ANALYZED',
    extracted_text text,
    analysis_error_code varchar(60),
    summary_status varchar(30) not null default 'NOT_SUMMARIZED',
    summary_text text,
    summary_error_code varchar(60),
    analyzed_at timestamp,
    created_at timestamp not null default current_timestamp,
    foreign key (note_id) references notes(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
);

alter table attachments add column if not exists extracted_text text;
alter table attachments add column if not exists analysis_error_code varchar(60);
alter table attachments add column if not exists analyzed_at timestamp;
alter table attachments add column if not exists analysis_version integer not null default 1;
alter table attachments add column if not exists analysis_reused boolean not null default false;
alter table attachments add column if not exists summary_status varchar(30) not null default 'NOT_SUMMARIZED';
alter table attachments add column if not exists summary_text text;
alter table attachments add column if not exists summary_error_code varchar(60);

create table if not exists generation_jobs (
    id varchar(36) primary key,
    request_id varchar(36) not null,
    user_id bigint not null,
    note_id varchar(36) not null,
    kind varchar(40) not null,
    status varchar(30) not null,
    source_note_version bigint not null,
    source_title varchar(200),
    source_body text,
    model varchar(100) not null,
    mock_result boolean not null default true,
    regenerate_from_job_id varchar(36),
    error_code varchar(60),
    created_at timestamp not null default current_timestamp,
    started_at timestamp,
    completed_at timestamp,
    unique (user_id, request_id),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (note_id) references notes(id) on delete cascade
);

alter table generation_jobs add column if not exists source_title varchar(200);
alter table generation_jobs add column if not exists source_body text;
alter table generation_jobs add column if not exists regenerate_from_job_id varchar(36);

create table if not exists generation_job_sources (
    job_id varchar(36) not null,
    source_id varchar(36) not null,
    original_name varchar(200) not null,
    extracted_text text not null,
    source_order integer not null,
    primary key (job_id, source_id),
    foreign key (job_id) references generation_jobs(id) on delete cascade
);

create table if not exists learning_artifacts (
    id varchar(36) primary key,
    job_id varchar(36) not null unique,
    user_id bigint not null,
    note_id varchar(36) not null,
    kind varchar(40) not null,
    title varchar(200) not null,
    content text not null,
    source_note_version bigint not null,
    model varchar(100) not null,
    mock_result boolean not null default true,
    version bigint not null default 0,
    created_at timestamp not null default current_timestamp,
    foreign key (job_id) references generation_jobs(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (note_id) references notes(id) on delete cascade
);

alter table learning_artifacts add column if not exists version bigint not null default 0;

create table if not exists note_activity (
    user_id bigint not null,
    note_id varchar(36) not null,
    activity_date date not null,
    primary key (user_id, note_id, activity_date),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (note_id) references notes(id) on delete cascade
);

create table if not exists recordings (
    id varchar(36) primary key,
    note_id varchar(36),
    course_id varchar(36) not null,
    user_id bigint not null,
    title varchar(100) not null,
    status varchar(30) not null,
    mime_type varchar(100) not null,
    storage_key varchar(300),
    duration_seconds double,
    size_bytes bigint not null default 0,
    next_sequence integer not null default 0,
    waveform_json text,
    created_at timestamp not null default current_timestamp,
    completed_at timestamp,
    constraint fk_recordings_note_link foreign key (note_id) references notes(id) on delete set null,
    foreign key (course_id) references courses(id) on delete cascade,
    foreign key (user_id) references users(id) on delete cascade
);

alter table recordings add column if not exists course_id varchar(36);
update recordings set course_id=(select course_id from notes where notes.id=recordings.note_id) where course_id is null;

create table if not exists recording_chunks (
    recording_id varchar(36) not null,
    sequence_number integer not null,
    size_bytes bigint not null,
    sha256 varchar(64) not null,
    primary key (recording_id, sequence_number),
    foreign key (recording_id) references recordings(id) on delete cascade
);

create table if not exists quiz_sets (
    id varchar(36) primary key,
    request_id varchar(36) not null,
    user_id bigint not null,
    course_id varchar(36) not null,
    note_id varchar(36) not null,
    title varchar(200) not null,
    source_note_version bigint not null,
    source_artifact_id varchar(36),
    mock_result boolean not null default true,
    created_at timestamp not null default current_timestamp,
    unique (user_id, request_id),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (course_id) references courses(id) on delete cascade,
    foreign key (note_id) references notes(id) on delete cascade
);

alter table quiz_sets add column if not exists source_artifact_id varchar(36);
alter table quiz_sets add column if not exists source_attachment_ids text not null default '';

create table if not exists quiz_questions (
    id varchar(36) primary key,
    quiz_set_id varchar(36) not null,
    question_order integer not null,
    prompt text not null,
    option_a text not null,
    option_b text not null,
    option_c text not null,
    option_d text not null,
    correct_index integer not null,
    explanation text not null,
    source_label varchar(300) not null,
    unique (quiz_set_id, question_order),
    foreign key (quiz_set_id) references quiz_sets(id) on delete cascade
);

alter table quiz_questions add column if not exists hint_text text not null default '';

create table if not exists quiz_attempts (
    id varchar(36) primary key,
    request_id varchar(36) not null,
    user_id bigint not null,
    quiz_set_id varchar(36) not null,
    mode varchar(20) not null,
    source_attempt_id varchar(36),
    status varchar(20) not null,
    total_questions integer not null,
    correct_answers integer,
    started_at timestamp not null default current_timestamp,
    completed_at timestamp,
    unique (user_id, request_id),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (quiz_set_id) references quiz_sets(id) on delete cascade
);

create table if not exists quiz_attempt_questions (
    attempt_id varchar(36) not null,
    question_id varchar(36) not null,
    question_order integer not null,
    primary key (attempt_id, question_id),
    foreign key (attempt_id) references quiz_attempts(id) on delete cascade,
    foreign key (question_id) references quiz_questions(id) on delete cascade
);

create table if not exists quiz_answers (
    attempt_id varchar(36) not null,
    question_id varchar(36) not null,
    selected_index integer not null,
    correct boolean not null,
    answered_at timestamp not null default current_timestamp,
    primary key (attempt_id, question_id),
    foreign key (attempt_id) references quiz_attempts(id) on delete cascade,
    foreign key (question_id) references quiz_questions(id) on delete cascade
);

create table if not exists flashcard_decks (
    id varchar(36) primary key,
    request_id varchar(36) not null,
    user_id bigint not null,
    course_id varchar(36) not null,
    note_id varchar(36) not null,
    title varchar(200) not null,
    source_note_version bigint not null,
    source_attachment_ids text not null default '',
    mock_result boolean not null default true,
    created_at timestamp not null default current_timestamp,
    unique (user_id, request_id),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (course_id) references courses(id) on delete cascade,
    foreign key (note_id) references notes(id) on delete cascade
);

alter table flashcard_decks add column if not exists source_attachment_ids text not null default '';

create table if not exists flashcards (
    id varchar(36) primary key,
    deck_id varchar(36) not null,
    card_order integer not null,
    front_text text not null,
    back_text text not null,
    explanation text not null,
    source_label varchar(300) not null,
    card_type varchar(30) not null default 'CUSTOM',
    unique (deck_id, card_order),
    foreign key (deck_id) references flashcard_decks(id) on delete cascade
);

alter table flashcards add column if not exists card_type varchar(30) not null default 'CUSTOM';
alter table flashcards add column if not exists repetition integer not null default 0;
alter table flashcards add column if not exists interval_days integer not null default 1;

create table if not exists flashcard_reviews (
    id varchar(36) primary key,
    request_id varchar(36) not null,
    user_id bigint not null,
    card_id varchar(36) not null,
    rating varchar(20) not null,
    reviewed_at timestamp not null default current_timestamp,
    next_review_at timestamp not null,
    unique (user_id, request_id),
    foreign key (user_id) references users(id) on delete cascade,
    foreign key (card_id) references flashcards(id) on delete cascade
);

create table if not exists school_courses (
    user_id bigint not null,
    external_id varchar(200) not null,
    course_id varchar(36) not null,
    schedule text not null,
    primary key (user_id, external_id),
    foreign key (course_id) references courses(id) on delete cascade
);

create table if not exists email_verification_tokens (
    id bigint auto_increment primary key,
    user_id bigint not null,
    token_hash varchar(255) not null unique,
    expires_at timestamp not null,
    used_at timestamp null,
    constraint fk_email_verification_user foreign key (user_id) references users(id) on delete cascade
);

create table if not exists password_reset_tokens (
    id bigint auto_increment primary key,
    user_id bigint not null,
    token_hash varchar(255) not null unique,
    expires_at timestamp not null,
    used_at timestamp null,
    created_at timestamp not null default current_timestamp,
    constraint fk_password_reset_user foreign key (user_id) references users(id) on delete cascade
);

create table if not exists account_file_cleanup (
    id bigint auto_increment primary key,
    kind varchar(20) not null,
    user_id bigint not null,
    item_key varchar(400) not null,
    attempts integer not null default 0,
    created_at timestamp not null default current_timestamp,
    completed_at timestamp null,
    last_error varchar(120) null
);

create table if not exists social_identities (
    id bigint auto_increment primary key,
    user_id bigint not null,
    provider varchar(30) not null,
    provider_user_id varchar(100) not null,
    provider_email varchar(254) null,
    created_at timestamp not null default current_timestamp,
    constraint uq_social_provider_user unique (provider, provider_user_id),
    constraint fk_social_identity_user foreign key (user_id) references users(id) on delete cascade
);

create table if not exists usage_records (
    id bigint auto_increment primary key,
    user_id bigint not null,
    kind varchar(40) not null,
    model varchar(100) not null,
    prompt_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    created_at timestamp not null default current_timestamp,
    foreign key (user_id) references users(id) on delete cascade
);
