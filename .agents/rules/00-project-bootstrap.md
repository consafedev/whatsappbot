---
trigger: always_on
---

# WhatsAppBot project bootstrap

Before a significant change:

1. Read `AGENTS.md`.
2. Load `.agents/skills/whatsapp-platform-engineering/SKILL.md`.
3. Read `platform_docs/docs/INDEX.md`.
4. Read the normative documents for the task.
5. Read `platform_docs/STATUS.md`.
6. Check `git status` and recent `git log`.

Never rely on memory of a previous chat as project truth.

If docs conflict:
recent explicit ADR > PRD > SYSTEM_DESIGN > DATA_MODEL/BACKLOG > SECURITY > UI_FLOWS > DESIGN > STATUS.

Do not silently resolve architecture conflicts.

Importante: Tu flujo de ejecución siempre debe ser:

1.- Investigo y entiendo mi tarea.
2.- Leo la documentación reelevante y cargo la skill del proyecto.
3.- Una vez que entiendo mi taréa, tengo información especifica y comprendo el alcance, planeo como lo resolveré.
4.- Una vez que tenga la planeación completa, si no necesito mas información procedo a desarrollar mi taréa.
5.- Una vez que termine un punto importante, checkpoint, o tarea, la analizaré y auditaré completamente.
6.- Si existe deuda, error, o faltante, lo corrijo planeando correctamente la mejor forma de hacerlo.
7.- una vez correjido, analizo y audito nuevamente lo que realicé.
8.- Cuando finalmente terminé mi taréa, sea correcta la implementación y no existan errores o deudas podré continuar hasta finalizar con lo solicitado.
9.- Actualizo correctamente la documentación que deba actualizar.
10.- Elaboro el commit correspondiente siendo siempre claro, descriptivo y especifico.