create table if not exists users (
    id bigint auto_increment primary key,
    email varchar(254) not null unique,
    password_hash varchar(255) not null,
    nickname varchar(50) not null,
    email_verified boolean not null default false,
    onboarding_completed boolean not null default false,
    created_at timestamp not null default current_timestamp
);

create table if not exists email_verification_tokens (
    id bigint auto_increment primary key,
    user_id bigint not null,
    token_hash varchar(255) not null unique,
    expires_at timestamp not null,
    used_at timestamp null,
    constraint fk_email_verification_user foreign key (user_id) references users(id) on delete cascade
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
