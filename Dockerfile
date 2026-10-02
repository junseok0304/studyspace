FROM gradle:9.5.0-jdk21 AS build
WORKDIR /workspace
COPY settings.gradle build.gradle ./
COPY src ./src
RUN gradle clean bootJar --no-daemon

FROM eclipse-temurin:21-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ffmpeg python3 python3-requests \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system studyspace \
    && useradd --system --gid studyspace --home-dir /app studyspace
WORKDIR /app
COPY --from=build /workspace/build/libs/studyspace.jar /app/studyspace.jar
COPY scripts/school_adapter.py /app/scripts/school_adapter.py
RUN mkdir -p /app/runtime && chown -R studyspace:studyspace /app
USER studyspace
EXPOSE 8091
ENTRYPOINT ["java","-XX:MaxRAMPercentage=75","-jar","/app/studyspace.jar"]
