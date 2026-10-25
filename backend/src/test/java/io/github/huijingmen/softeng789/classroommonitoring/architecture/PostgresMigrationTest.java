package io.github.huijingmen.softeng789.classroommonitoring.architecture;

import io.github.huijingmen.softeng789.classroommonitoring.config.LegacySchemaAdoption;
import io.github.huijingmen.softeng789.classroommonitoring.config.LegacySchemaAlignment;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import static org.assertj.core.api.Assertions.*;

@EnabledIfSystemProperty(named="schemaCheck.url", matches="jdbc:postgresql://127\\.0\\.0\\.1:.*classlens_schema_.*")
class PostgresMigrationTest {
    @Test void versionedFreshAndReviewedLegacyUpgradesAreRepeatableAndRejectChecksumDrift() throws Exception {
        String url=System.getProperty("schemaCheck.url");
        var flyway=Flyway.configure().dataSource(url,"postgres","schema-test-only").defaultSchema("public")
                .baselineVersion("1").baselineOnMigrate(false).validateOnMigrate(true).cleanDisabled(true).outOfOrder(false).load();
        // Reproduce a phase1 database with real rows before adding the phase2 tables.
        if (url.endsWith("_v3") || url.endsWith("_v5") || url.endsWith("_v6")) {
            Flyway.configure().dataSource(url,"postgres","schema-test-only").defaultSchema("public")
                    .target(url.endsWith("_v6") ? "6" : url.endsWith("_v5") ? "5" : "3").cleanDisabled(true).load().migrate();
            try (var c = DriverManager.getConnection(url,"postgres","schema-test-only"); var q = c.createStatement()) {
                q.executeUpdate("INSERT INTO students(student_number,university_email,first_name,last_name,course,seat) "
                        + "VALUES ('PHASE1-PRESERVE','preserve@example.test','Synthetic','Student','TEST','A1')");
            }
        }
        Map<String,String> before;
        try(var connection=DriverManager.getConnection(url,"postgres","schema-test-only")) {
            before=counts(connection);
            if(url.endsWith("upgrade") || url.endsWith("localcopy")) {
                assertThatThrownBy(flyway::migrate).hasMessageContaining("non-empty");
                try(var sql=connection.createStatement()) {
                    sql.execute("ALTER TABLE students RENAME COLUMN first_name TO baseline_mismatch");
                    try { assertThatThrownBy(()->LegacySchemaAdoption.baseline(flyway)).hasMessageContaining("adoption refused"); }
                    finally { sql.execute("ALTER TABLE students RENAME COLUMN baseline_mismatch TO first_name"); }
                }
                if(url.endsWith("localcopy")) {
                    assertThatThrownBy(()->LegacySchemaAdoption.baseline(flyway)).hasMessageContaining("adoption refused");
                    LegacySchemaAlignment.align(flyway);
                }
                LegacySchemaAdoption.baseline(flyway);
            }
            flyway.migrate();
            assertThat(flyway.migrate().migrationsExecuted).isZero();
            flyway.validate();
            assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("8");
            try (var q = connection.createStatement(); var r = q.executeQuery(
                    "SELECT to_regclass('public.cv_student_checkins') IS NOT NULL AND to_regclass('public.cv_registration_faces') IS NOT NULL AND to_regclass('public.attendance_review_events') IS NOT NULL AND to_regclass('public.webcam_sharing_runs') IS NOT NULL AND to_regclass('public.webcam_observations') IS NOT NULL")) {
                assertThat(r.next()).isTrue(); assertThat(r.getBoolean(1)).isTrue();
            }
            var after=counts(connection);
            before.forEach((table,count)->assertThat(after.get(table)).as(table).isEqualTo(count));
            if(before.isEmpty()) {
                assertThat(after.get("students")).startsWith("0:");assertThat(after.get("teachers")).startsWith("0:");assertThat(after.get("courses")).startsWith("0:");
            }
            assertThatThrownBy(flyway::clean).hasMessageContaining("cleanDisabled");
            assertThatThrownBy(()->LegacySchemaAdoption.baseline(flyway)).hasMessageContaining("Already versioned");
            int checksum;
            try(var sql=connection.createStatement();var row=sql.executeQuery("SELECT checksum FROM flyway_schema_history WHERE version='2'")) {
                assertThat(row.next()).isTrue();checksum=row.getInt(1);
            }
            try(var sql=connection.createStatement()) {
                sql.executeUpdate("UPDATE flyway_schema_history SET checksum=checksum+1 WHERE version='2'");
                try { assertThatThrownBy(flyway::validate).hasMessageContaining("checksum mismatch"); }
                finally { sql.executeUpdate("UPDATE flyway_schema_history SET checksum="+checksum+" WHERE version='2'"); }
            }
            flyway.validate();
        }
    }
    private Map<String,String> counts(Connection connection) throws SQLException {
        Map<String,String> result=new TreeMap<>();
        List<String> names=new ArrayList<>();
        try(var sql=connection.createStatement();var rows=sql.executeQuery("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'flyway_schema_history'")) {
            while(rows.next())names.add(rows.getString(1));
        }
        for(String name:names) {
            if(!name.matches("[a-z_]+"))throw new IllegalStateException("Unexpected table identifier");
            // Compare row values too, including historical dates, password hashes and frozen documents.
            // Ignore only the newly added nullable received_date field, which has no historical source.
            String digest="md5((to_jsonb(t)-'received_date')::text)";
            try(var sql=connection.createStatement();var row=sql.executeQuery("SELECT count(*) || ':' || md5(coalesce(string_agg("
                    +digest+",'' ORDER BY "+digest+"),'')) FROM public.\""+name+"\" t")) {
                row.next();result.put(name,row.getString(1));
            }
        }
        return result;
    }
}
