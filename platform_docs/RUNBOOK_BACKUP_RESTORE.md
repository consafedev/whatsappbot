# RUNBOOK_BACKUP_RESTORE.md — Backup y restauración

**Versión:** 1.0-draft  
**Fecha:** 2026-08-12  
**Objetivo:** procedimiento operativo reproducible para respaldar y restaurar la plataforma. Los comandos finales se ajustarán cuando existan nombres reales de servicios/scripts; no inventarlos antes de implementar.

---

# 1. Política

Producción primaria vive en servidor propio.

Backup offsite:

- Google Drive;
- asíncrono;
- comprimido;
- cifrado antes de upload;
- checksum;
- dos copias verificadas: current + previous.

No borrar backup antiguo antes de verificar el nuevo.

---

# 2. Requisitos

Antes de habilitar backup productivo deben existir:

- herramienta de dump PostgreSQL compatible;
- compresión;
- cifrado (ej. age o alternativa aprobada);
- upload Drive (ej. rclone o integración aprobada);
- carpeta temporal con espacio;
- secreto de cifrado fuera de Drive/repo;
- script versionado sin secrets;
- logging/status.

---

# 3. Contenido del backup

Artifact conceptual:

```text
backup-<timestamp>-<app-version>.tar.zst.age
```

Contiene antes de cifrar:

```text
manifest.json
database/postgres.dump
storage/...
config/non-secret-recovery-metadata/...
```

Manifest mínimo:

- backup_id;
- created_at UTC;
- app_version;
- schema/migration version;
- DB dump format/version;
- included paths;
- size;
- checksums internos;
- host/deployment id.

---

# 4. Backup normal — procedimiento

1. Confirmar que no hay un backup job activo para el mismo deployment.
2. Confirmar espacio libre local suficiente.
3. Crear working directory con permisos restrictivos.
4. Ejecutar dump consistente de PostgreSQL.
5. Capturar storage requerido según snapshot strategy.
6. Crear manifest.
7. Verificar que dump/archivos mínimos existan y no sean cero.
8. Comprimir.
9. Cifrar.
10. Calcular checksum del artifact cifrado.
11. Subir a ubicación temporal/nombre versionado en Drive.
12. Verificar upload: existencia + tamaño y checksum si tooling lo permite.
13. Registrar `verified_at`.
14. Promover nuevo a current lógico.
15. current anterior pasa a previous.
16. eliminar copia que ahora sería tercera.
17. eliminar temporales locales según política.
18. registrar resultado y duración.

Si cualquier paso 1–13 falla, **no rotar/borrar backups remotos existentes**.

---

# 5. Fallo de backup

Registrar:

- stage;
- error code;
- start/end;
- artifact partial;
- disk state;
- remote state.

Acciones:

- no eliminar backups anteriores;
- limpiar sólo temporales identificados;
- alertar si supera freshness threshold;
- reintentar según policy.

---

# 6. Verificación periódica

No considerar “backup exitoso” sólo porque upload terminó.

Verificar:

- artifact exists;
- decrypt test controlado o header/recipient validation;
- archive integrity;
- DB dump list/restore compatibility;
- manifest matches.

---

# 7. Restore drill

Antes del primer cliente pagado y tras cambios importantes:

1. provisionar entorno aislado;
2. obtener `current` backup;
3. verificar checksum;
4. descifrar con key de recuperación;
5. descomprimir;
6. validar manifest;
7. restaurar PostgreSQL a instancia vacía;
8. restaurar storage;
9. aplicar sólo pasos de compatibilidad explícitos si versión lo requiere;
10. iniciar app con configuración aislada;
11. verificar tenants/users/contacts/messages/processes/files;
12. ejecutar smoke/integrity tests;
13. registrar drill con fecha/duración/problemas.

No ejecutar drill destructivo sobre producción.

---

# 8. Disaster restore real

Prioridades:

1. preservar evidencia/estado actual si posible;
2. detener writes si DB inconsistente;
3. identificar último backup verificado;
4. provisionar host/DB limpia;
5. restaurar;
6. verificar integridad;
7. configurar secrets/providers;
8. levantar servicios internos;
9. validar app;
10. reactivar edge/tráfico;
11. verificar channel sessions; algunas pueden requerir reauth;
12. reconciliar outbox/scheduled jobs;
13. comunicar estado a clientes afectados si corresponde.

---

# 9. Rotación de dos copias

Mantener referencia lógica en metadata, no depender únicamente de renombrar archivos remotos.

Ejemplo:

```text
Backup A verified -> previous
Backup B verified -> current
```

Al crear C:

```text
C verified
B -> previous
C -> current
A delete
```

Si C falla:

```text
A previous
B current
```

permanece intacto.

---

# 10. Cifrado

Private key/passphrase:

- no en Git;
- no en Drive junto al backup;
- mantener copia de recuperación segura;
- documentar owner/custody;
- probar que realmente descifra.

Perder la key equivale a perder backups.

---

# 11. Escala futura

Cuando storage sea demasiado grande para backup completo frecuente, evaluar ADR para separar:

- DB/config backup frecuente;
- object/file storage incremental/versionado;
- snapshots.

No cambiar sin restore strategy equivalente.
