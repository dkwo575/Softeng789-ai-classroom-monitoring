package io.github.huijingmen.softeng789.classroommonitoring.repository;
import io.github.huijingmen.softeng789.classroommonitoring.entity.StudentGuardian;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
public interface StudentGuardianRepository extends JpaRepository<StudentGuardian, UUID> {}
