package kr.omong.studyspace.study;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/** Makes course ownership independent from a recording's optional linked note. */
@Component
public class RecordingOwnershipMigration implements ApplicationRunner {
    private static final String LINK_CONSTRAINT = "FK_RECORDINGS_NOTE_LINK";
    private final DataSource dataSource;

    public RecordingOwnershipMigration(DataSource dataSource) { this.dataSource = dataSource; }

    @Override public void run(ApplicationArguments args) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            DatabaseMetaData metadata = connection.getMetaData();
            String catalog = connection.getCatalog();
            String schema = connection.getSchema();
            String product = metadata.getDatabaseProductName().toLowerCase();
            boolean mysql = product.contains("mysql");
            List<String> noteConstraints = new ArrayList<>();
            boolean hasSetNullLink = false;

            try (ResultSet keys = metadata.getImportedKeys(catalog, schema, "RECORDINGS")) {
                while (keys.next()) {
                    if (!"NOTES".equalsIgnoreCase(keys.getString("PKTABLE_NAME"))) continue;
                    String name = keys.getString("FK_NAME");
                    if (name == null || !name.matches("[A-Za-z0-9_]+")) continue;
                    if (LINK_CONSTRAINT.equalsIgnoreCase(name)
                            && keys.getShort("DELETE_RULE") == DatabaseMetaData.importedKeySetNull) {
                        hasSetNullLink = true;
                    } else {
                        noteConstraints.add(name);
                    }
                }
            }

            try (Statement statement = connection.createStatement()) {
                for (String name : noteConstraints) {
                    String escaped = mysql ? "`" + name + "`" : "\"" + name + "\"";
                    statement.execute("alter table recordings drop " + (mysql ? "foreign key " : "constraint ") + escaped);
                }
                statement.execute(mysql
                        ? "alter table recordings modify column note_id varchar(36) null"
                        : "alter table recordings alter column note_id drop not null");
                if (!hasSetNullLink) {
                    statement.execute("alter table recordings add constraint " + LINK_CONSTRAINT
                            + " foreign key (note_id) references notes(id) on delete set null");
                }
            }
        }
    }
}
