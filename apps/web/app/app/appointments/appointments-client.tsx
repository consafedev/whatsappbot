"use client";

import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ContactItem,
  fetchContactDetail,
  fetchContacts,
} from "../contacts/contacts-view-model";
import { fetchConversations, type InboxConversation } from "../inbox/inbox-view-model";
import type { OrganizationUnitItem } from "../settings/organization-units/tenant-organization-units-tree";
import { useTenantAppBootstrap } from "../tenant-app-shell";
import {
  dateKeyInZone,
  formatLocalDateTime,
  formatZoned,
  getCalendarWindow,
  getVisibleAppointmentDays,
  resolveLocalTime,
} from "./appointment-calendar";
import {
  beginCommandIntent,
  type CommandKeyEntry,
  stableCommandKey,
} from "./appointment-command-key";
import { loadContactConversations, resolveAssociationPatch } from "./appointment-form-model";
import styles from "./appointments.module.css";
import {
  AppointmentApiError,
  type AppointmentItem,
  type AppointmentListFilters,
  type AppointmentResourceInput,
  type AvailabilitySlot,
  createAppointmentsApi,
  type ExceptionItem,
  getAppointmentCapabilities,
  type ReminderItem,
  type ResourceItem,
  type RuleItem,
  type ServiceItem,
} from "./appointments-view-model";

const PAGE_SIZE = 50;
const AVAILABILITY_PAGE_SIZE = 500;
const SLOT_DISPLAY_PAGE_SIZE = 25;
const STATUS_LABELS: Record<AppointmentItem["status"], string> = {
  REQUESTED: "Solicitada",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  COMPLETED: "Completada",
  NO_SHOW: "No asistió",
  RESCHEDULED: "Reprogramada",
};
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const RESOURCE_TYPES = ["PRACTITIONER", "FACILITY", "ROOM", "EQUIPMENT", "OTHER"] as const;

type View = "day" | "week" | "list";
type ConfigPanel = "services" | "resources" | "rules" | "exceptions";
type Editable = ServiceItem | ResourceItem | RuleItem | ExceptionItem | null;

function apiErrorMessage(error: unknown): string {
  if (error instanceof AppointmentApiError) {
    if (error.statusCode === 401)
      return "Tu sesión expiró. Vuelve a iniciar sesión para continuar.";
    if (error.statusCode === 403)
      return "Tu acceso a esta acción cambió. Actualiza la sesión o consulta a una persona administradora.";
    if (error.statusCode === 404) return "El registro ya no está disponible. Actualiza la lista.";
    if (error.statusCode === 409)
      return "El horario cambió y ya no está disponible. Actualiza los horarios para elegir otra opción.";
  }
  return error instanceof Error ? error.message : "No fue posible completar la solicitud.";
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateLabel(dateKey: string, _zone: string): string {
  const instant = new Date(`${dateKey}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(instant);
}

function timeLabel(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  }).format(new Date(instant));
}

function useDialogFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    const target = dialog?.querySelector<HTMLElement>(
      "[data-autofocus], button, input, select, textarea",
    );
    target?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')?.focus();
    };
  }, [open, ref]);
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
  modal = true,
  disableClose = false,
}: Readonly<{
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  modal?: boolean;
  disableClose?: boolean;
}>) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(true, ref);
  return (
    <div className={styles.backdrop} role="presentation">
      <section
        aria-labelledby="appointment-dialog-title"
        aria-modal={modal}
        className={`${styles.dialog}${wide ? ` ${styles.dialogWide}` : ""}`}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !disableClose) {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const elements = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
              ),
            );
            if (elements.length === 0) {
              event.preventDefault();
              event.currentTarget.focus();
              return;
            }
            const first = elements.at(0);
            const last = elements.at(-1);
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        ref={ref}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <h2 id="appointment-dialog-title">{title}</h2>
          <button
            aria-label="Cerrar"
            className={styles.iconButton}
            disabled={disableClose}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function AlertLayer({
  title,
  titleId,
  children,
  onEscape,
}: Readonly<{ title: string; titleId: string; children: ReactNode; onEscape: () => void }>) {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(true, ref);
  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className={styles.confirmLayer}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
          return;
        }
        if (event.key !== "Tab") return;
        const elements = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (elements.length === 0) {
          event.preventDefault();
          ref.current?.focus();
          return;
        }
        const first = elements.at(0);
        const last = elements.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      role="alertdialog"
    >
      <section className={styles.confirmBox} ref={ref} tabIndex={-1}>
        <h3 id={titleId}>{title}</h3>
        {children}
      </section>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: AppointmentItem["status"] }>) {
  return (
    <span className={`${styles.status} ${styles[`status${status}`]}`}>{STATUS_LABELS[status]}</span>
  );
}

function Pager({
  page,
  total,
  onChange,
}: Readonly<{ page: number; total: number; onChange: (page: number) => void }>) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav aria-label="Paginación" className={styles.pager}>
      <span>
        {total === 0
          ? "Sin registros"
          : `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} de ${total}`}
      </span>
      <div>
        <button disabled={page === 0} onClick={() => onChange(page - 1)} type="button">
          Anterior
        </button>
        <span aria-live="polite">
          Página {page + 1} de {pages}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} type="button">
          Siguiente
        </button>
      </div>
    </nav>
  );
}

export function AppointmentsClient({ apiBaseUrl }: Readonly<{ apiBaseUrl?: string }>) {
  const bootstrap = useTenantAppBootstrap();
  const base = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
  const api = useMemo(() => createAppointmentsApi(base), [base]);
  const capabilities = useMemo(
    () =>
      getAppointmentCapabilities({
        modules: bootstrap.effectiveModules,
        permissions: bootstrap.effectivePermissions,
      }),
    [bootstrap.effectiveModules, bootstrap.effectivePermissions],
  );
  const [zone, setZone] = useState(bootstrap.tenant.defaultTimezone || "UTC");
  const [dateKey, setDateKey] = useState(() =>
    dateKeyInZone(new Date(), bootstrap.tenant.defaultTimezone || "UTC"),
  );
  const [view, setView] = useState<View>("week");
  const [status, setStatus] = useState<NonNullable<AppointmentListFilters["status"]> | "ALL">(
    "ALL",
  );
  const [resourceFilter, setResourceFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [page, setPage] = useState(0);
  const [appointments, setAppointments] = useState<readonly AppointmentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [services, setServices] = useState<readonly ServiceItem[]>([]);
  const [resources, setResources] = useState<readonly ResourceItem[]>([]);
  const [units, setUnits] = useState<readonly OrganizationUnitItem[]>([]);
  const [lookupErrors, setLookupErrors] = useState<string[]>([]);
  const [dialog, setDialog] = useState<"create" | "detail" | "config" | null>(null);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppointmentItem | null>(null);
  const [detailContact, setDetailContact] = useState<ContactItem | null>(null);
  const [reminders, setReminders] = useState<readonly ReminderItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [rebookMode, setRebookMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contacts, setContacts] = useState<readonly ContactItem[]>([]);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<ContactItem | null>(null);
  const [conversationOptions, setConversationOptions] = useState<readonly InboxConversation[]>([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationLookupError, setConversationLookupError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [resourceSearch, setResourceSearch] = useState("");
  const [localStart, setLocalStart] = useState("");
  const [foldChoice, setFoldChoice] = useState<number | null>(null);
  const [slots, setSlots] = useState<readonly AvailabilitySlot[]>([]);
  const [slotPage, setSlotPage] = useState(0);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [chosenSlot, setChosenSlot] = useState<AvailabilitySlot | null>(null);
  const [notes, setNotes] = useState("");
  const [offsets, setOffsets] = useState<number[]>([]);
  const idempotency = useRef(new Map<string, CommandKeyEntry>());
  const availabilityController = useRef<AbortController | null>(null);
  const detailGeneration = useRef(0);
  const detailIdentity = useRef<string | null>(null);

  const invalidateAvailability = () => {
    availabilityController.current?.abort();
    availabilityController.current = null;
    setSlotLoading(false);
    setSlots([]);
    setSlotPage(0);
    setChosenSlot(null);
  };

  const commandKey = useCallback((intent: string, payload: unknown) => {
    return stableCommandKey(idempotency.current, intent, payload, () => crypto.randomUUID());
  }, []);

  const calendarWindow = useMemo(() => {
    try {
      return getCalendarWindow(dateKey, view, zone);
    } catch (error) {
      return { days: [], from: "", to: "", error: apiErrorMessage(error) } as const;
    }
  }, [dateKey, view, zone]);

  // refreshVersion deliberately re-runs the server query after a successful mutation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshVersion is an intentional refresh trigger.
  useEffect(() => {
    if (!capabilities.canReadAppointments || !calendarWindow.from || !calendarWindow.to) {
      setLoading(false);
      setAppointments([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setListError(null);
    const filters: AppointmentListFilters = {
      from: calendarWindow.from,
      to: calendarWindow.to,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(status === "ALL" ? {} : { status }),
      ...(resourceFilter ? { resourceId: resourceFilter } : {}),
      ...(serviceFilter ? { serviceId: serviceFilter } : {}),
      ...(unitFilter ? { organizationUnitId: unitFilter } : {}),
    };
    void api
      .list(filters, { signal: controller.signal })
      .then((result) => {
        if (!current) return;
        setAppointments(result.items);
        setTotal(result.total);
      })
      .catch((error: unknown) => {
        if (!current || (error instanceof Error && error.name === "AbortError")) return;
        setListError(apiErrorMessage(error));
        setAppointments([]);
        setTotal(0);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [
    api,
    calendarWindow.from,
    calendarWindow.to,
    capabilities.canReadAppointments,
    page,
    refreshVersion,
    resourceFilter,
    serviceFilter,
    status,
    unitFilter,
  ]);

  useEffect(() => {
    if (!capabilities.canReadAppointments) return;
    const controller = new AbortController();
    let current = true;
    setLookupErrors([]);
    const problems: string[] = [];
    void Promise.all([
      listAllServices(api, controller.signal)
        .then((items) => {
          if (current) setServices(items);
        })
        .catch((error: unknown) => {
          if (current && !(error instanceof Error && error.name === "AbortError"))
            problems.push(`Servicios: ${apiErrorMessage(error)}`);
        }),
      listAllResources(api, controller.signal)
        .then((items) => {
          if (current) setResources(items);
        })
        .catch((error: unknown) => {
          if (current && !(error instanceof Error && error.name === "AbortError"))
            problems.push(`Recursos: ${apiErrorMessage(error)}`);
        }),
    ]).then(() => {
      if (current) setLookupErrors(problems);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [api, capabilities.canReadAppointments]);

  useEffect(() => {
    if (!capabilities.canReadAppointments || !capabilities.canLookupOrganizationUnits) return;
    const controller = new AbortController();
    let current = true;
    void fetch(`${base.replace(/\/$/, "")}/app/organization-units`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Tu sesión expiró.");
        if (response.status === 403)
          throw new Error("No tienes permiso para consultar unidades organizativas.");
        if (!response.ok) throw new Error(`No fue posible cargar unidades (${response.status}).`);
        return response.json() as Promise<{ items?: OrganizationUnitItem[] }>;
      })
      .then((result) => {
        if (current) setUnits(Array.isArray(result.items) ? result.items : []);
      })
      .catch((error: unknown) => {
        if (current && !(error instanceof Error && error.name === "AbortError"))
          setLookupErrors((currentErrors) => [
            ...currentErrors,
            `Unidades: ${apiErrorMessage(error)}`,
          ]);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [base, capabilities.canLookupOrganizationUnits, capabilities.canReadAppointments]);

  useEffect(() => {
    if (dialog !== "detail" || selectedAppointmentId === null || !capabilities.canReadAppointments)
      return;
    const controller = new AbortController();
    let current = true;
    setDetailLoading(true);
    setDetailError(null);
    setActionError(null);
    setDetail(null);
    setDetailContact(null);
    setReminders([]);
    void api
      .get(selectedAppointmentId, { signal: controller.signal })
      .then((item) => {
        if (current) {
          setDetail(item);
          setSelectedServiceId(item.serviceId);
          setSelectedResourceId(item.resourceId ?? "");
          setLocalStart(formatLocalDateTime(item.startsAt, zone));
          setFoldChoice(null);
        }
        if (current && capabilities.canLookupContacts) {
          void fetchContactDetail(base, item.contactId)
            .then((contact) => {
              if (current) setDetailContact(contact);
            })
            .catch(() => {
              if (current) setDetailContact(null);
            });
        }
      })
      .catch((error: unknown) => {
        if (current && !(error instanceof Error && error.name === "AbortError"))
          setDetailError(apiErrorMessage(error));
      })
      .finally(() => {
        if (current) setDetailLoading(false);
      });
    void api
      .reminders(selectedAppointmentId, { signal: controller.signal })
      .then((items) => {
        if (current) setReminders(items);
      })
      .catch((error: unknown) => {
        if (current && !(error instanceof Error && error.name === "AbortError"))
          setActionError(`No fue posible consultar los recordatorios: ${apiErrorMessage(error)}`);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [
    api,
    base,
    capabilities.canLookupContacts,
    capabilities.canReadAppointments,
    dialog,
    selectedAppointmentId,
    zone,
  ]);

  useEffect(() => {
    if (
      dialog !== "create" ||
      !capabilities.canLookupContacts ||
      contactSearch.trim().length < 2 ||
      selectedContact !== null
    ) {
      setContacts([]);
      setContactLoading(false);
      return;
    }
    let current = true;
    setContacts([]);
    setContactTotal(0);
    const timer = globalThis.setTimeout(() => {
      setContactLoading(true);
      setContactError(null);
      void fetchContacts(base, { search: contactSearch.trim(), limit: 20, page: contactPage })
        .then((response) => {
          if (current) {
            setContacts(response.items);
            setContactTotal(response.total);
          }
        })
        .catch((error: unknown) => {
          if (current) setContactError(apiErrorMessage(error));
        })
        .finally(() => {
          if (current) setContactLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      globalThis.clearTimeout(timer);
    };
  }, [base, capabilities.canLookupContacts, contactPage, contactSearch, dialog, selectedContact]);

  useEffect(() => {
    if (dialog !== "create" || !capabilities.canLookupConversations || selectedContact === null) {
      setConversationOptions([]);
      setConversationLookupError(null);
      return;
    }
    let current = true;
    setConversationLookupError(null);
    setConversationLoading(true);
    void loadContactConversations(
      ({ cursor, limit }) =>
        fetchConversations(base, {
          search: selectedContact.phoneNumber,
          limit,
          ...(cursor ? { cursor } : {}),
        }),
      selectedContact.id,
    )
      .then((items) => {
        if (current) setConversationOptions(items);
      })
      .catch(() => {
        if (current) {
          setConversationOptions([]);
          setSelectedConversationId("");
          setOffsets([]);
          setConversationLookupError("No fue posible cargar las conversaciones de este cliente.");
        }
      })
      .finally(() => {
        if (current) setConversationLoading(false);
      });
    return () => {
      current = false;
    };
  }, [base, capabilities.canLookupConversations, dialog, selectedContact]);

  // Abort in-flight availability whenever any of its query inputs or its owning dialog changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependency changes are the cleanup trigger.
  useEffect(
    () => () => availabilityController.current?.abort(),
    [dialog, localStart, rebookMode, selectedResourceId, selectedServiceId, zone],
  );

  const activeServices = services.filter((item) => item.active);
  const activeResources = resources.filter((item) => item.active);
  const navigateDate = (offset: number) => {
    const span = view === "day" ? 1 : 7;
    setDateKey(addCalendarDays(dateKey, offset * span));
    setPage(0);
  };
  const openCreate = () => {
    invalidateAvailability();
    beginCommandIntent(idempotency.current, "create");
    setSelectedContact(null);
    setContactSearch("");
    setContactPage(1);
    setContactTotal(0);
    setSelectedServiceId("");
    setSelectedResourceId("");
    setServiceSearch("");
    setResourceSearch("");
    setLocalStart(`${dateKey}T09:00`);
    setFoldChoice(null);
    setSlots([]);
    setChosenSlot(null);
    setSlotError(null);
    setNotes("");
    setOffsets([]);
    setSelectedConversationId("");
    setDialog("create");
  };
  const refreshList = () => setRefreshVersion((current) => current + 1);
  const openDetail = (id: string) => {
    invalidateAvailability();
    detailGeneration.current += 1;
    detailIdentity.current = id;
    setSelectedAppointmentId(id);
    setRebookMode(false);
    setDialog("detail");
  };
  const refreshDetail = async (id: string, generation = detailGeneration.current) => {
    const [item, reminderItems] = await Promise.all([
      api.get(id),
      api.reminders(id).catch(() => [] as readonly ReminderItem[]),
    ]);
    if (generation !== detailGeneration.current || detailIdentity.current !== id) return;
    setDetail(item);
    setReminders(reminderItems);
    setAppointments((current) => current.map((row) => (row.id === id ? item : row)));
  };

  const saveAppointment = async () => {
    if (selectedContact === null || chosenSlot === null || !selectedServiceId) return;
    if (offsets.length > 0 && !selectedConversationId) {
      setSlotError(
        "Elige una conversación para guardar los recordatorios o desmarca sus horarios.",
      );
      return;
    }
    const payload = {
      contactId: selectedContact.id,
      resourceId: chosenSlot.resourceId,
      serviceId: selectedServiceId,
      startsAt: chosenSlot.startsAt,
      notes: notes.trim() || null,
      reminderPolicy:
        offsets.length > 0 && selectedConversationId
          ? {
              conversationId: selectedConversationId,
              offsetMinutes: [...offsets].sort((left, right) => left - right),
            }
          : null,
    };
    const idempotencyKey = commandKey("create", payload);
    setBusy(true);
    setSlotError(null);
    try {
      await api.create({ ...payload, idempotencyKey });
      setDialog(null);
      setToast("Cita creada y confirmada.");
      refreshList();
    } catch (error) {
      const conflict = error instanceof AppointmentApiError && error.statusCode === 409;
      setSlotError(
        conflict
          ? "Ese horario dejó de estar disponible. Conservamos los datos y puedes volver a consultar horarios."
          : apiErrorMessage(error),
      );
      if (conflict) setChosenSlot(null);
    } finally {
      setBusy(false);
    }
  };

  const searchSlots = async (
    serviceOverride?: string,
    resourceOverride?: string,
    timezoneOverride?: string,
  ) => {
    invalidateAvailability();
    setSlotError(null);
    const serviceId = serviceOverride ?? selectedServiceId;
    const resourceId = resourceOverride ?? selectedResourceId;
    if (!serviceId || !resourceId || !localStart) return;
    let instants: string[];
    try {
      instants = resolveLocalTime(localStart, timezoneOverride ?? zone);
    } catch (error) {
      setSlotError(apiErrorMessage(error));
      return;
    }
    if (instants.length === 0) {
      setSlotError(
        "La hora local seleccionada no existe por el cambio de horario. Elige otra hora.",
      );
      return;
    }
    if (instants.length > 1 && foldChoice === null) {
      setSlotError("Elige cuál de las dos horas locales corresponde a esta cita.");
      return;
    }
    const start = instants[Math.min(foldChoice ?? 0, instants.length - 1)];
    if (!start) {
      setSlotError("No fue posible resolver la hora seleccionada.");
      return;
    }
    const end = new Date(Date.parse(start) + 7 * 24 * 60 * 60 * 1000).toISOString();
    const controller = new AbortController();
    availabilityController.current = controller;
    setSlotLoading(true);
    setSlotError(null);
    try {
      const found: AvailabilitySlot[] = [];
      let cursor = start;
      let pageIndex = 0;
      while (Date.parse(cursor) < Date.parse(end) && pageIndex < 1000) {
        pageIndex += 1;
        const result = await api.availability(
          {
            from: cursor,
            to: end,
            serviceId,
            resourceId,
            limit: AVAILABILITY_PAGE_SIZE,
          },
          { signal: controller.signal },
        );
        if (availabilityController.current !== controller || controller.signal.aborted) return;
        found.push(...result.slots);
        if (!result.nextFrom) break;
        const nextCursor = Date.parse(result.nextFrom);
        if (!Number.isFinite(nextCursor) || nextCursor <= Date.parse(cursor))
          throw new Error("La búsqueda de horarios no pudo avanzar a la página siguiente.");
        if (nextCursor >= Date.parse(end)) break;
        cursor = result.nextFrom;
      }
      if (Date.parse(cursor) < Date.parse(end) && pageIndex >= 1000)
        throw new Error("No fue posible completar la búsqueda de horarios. Inténtalo de nuevo.");
      if (availabilityController.current !== controller || controller.signal.aborted) return;
      setSlots(found.sort((left, right) => left.startsAt.localeCompare(right.startsAt)));
      if (found.length === 0)
        setSlotError("No hay horarios disponibles en las próximas 168 horas para este recurso.");
    } catch (error) {
      if (
        availabilityController.current === controller &&
        !controller.signal.aborted &&
        !(error instanceof Error && error.name === "AbortError")
      )
        setSlotError(apiErrorMessage(error));
    } finally {
      if (availabilityController.current === controller) setSlotLoading(false);
    }
  };

  const cancelAppointment = async () => {
    if (!detail || !capabilities.canManageAppointments) return;
    const id = detail.id;
    const generation = detailGeneration.current;
    setBusy(true);
    setActionError(null);
    try {
      await api.cancel(id);
      refreshList();
      if (generation !== detailGeneration.current || detailIdentity.current !== id) return;
      await refreshDetail(id, generation);
      if (generation !== detailGeneration.current || detailIdentity.current !== id) return;
      setConfirmCancel(false);
      setToast("Cita cancelada. Su historial se conserva.");
    } catch (error) {
      if (generation === detailGeneration.current && detailIdentity.current === id)
        setActionError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const submitRebook = async () => {
    if (!detail || !chosenSlot || !capabilities.canManageAppointments) return;
    const originalId = detail.id;
    const generation = detailGeneration.current;
    const payload = {
      appointmentId: detail.id,
      resourceId: chosenSlot.resourceId,
      startsAt: chosenSlot.startsAt,
    };
    const idempotencyKey = commandKey(`rebook:${detail.id}`, payload);
    setBusy(true);
    setActionError(null);
    try {
      const replacement = await api.rebook(detail.id, {
        startsAt: chosenSlot.startsAt,
        resourceId: chosenSlot.resourceId,
        idempotencyKey,
      });
      refreshList();
      if (generation !== detailGeneration.current || detailIdentity.current !== originalId) return;
      detailIdentity.current = replacement.id;
      setSelectedAppointmentId(replacement.id);
      setDetail(replacement);
      setRebookMode(false);
      setChosenSlot(null);
      setSlots([]);
      setToast(
        "Cita reprogramada. La cita original permanece en el historial y el nuevo horario tiene su propio registro.",
      );
    } catch (error) {
      if (generation === detailGeneration.current && detailIdentity.current === originalId) {
        setActionError(apiErrorMessage(error));
        if (error instanceof AppointmentApiError && error.statusCode === 409) setChosenSlot(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = () => {
    if (busy) return;
    detailGeneration.current += 1;
    detailIdentity.current = null;
    invalidateAvailability();
    setConfirmCancel(false);
    setDialog(null);
    setSelectedAppointmentId(null);
    setDetail(null);
    setRebookMode(false);
    setChosenSlot(null);
  };

  if (!capabilities.canReadAppointments) {
    const hasModule = bootstrap.effectiveModules.includes("module.appointments");
    return (
      <section className={styles.accessState}>
        <span aria-hidden="true" className={styles.accessMark}>
          {hasModule ? "!" : "◇"}
        </span>
        <h1>{hasModule ? "Permiso de lectura requerido" : "Agenda no está activa"}</h1>
        <p>
          {hasModule ? (
            <>
              Tu rol necesita <code>appointments.read</code> para consultar las citas.
            </>
          ) : (
            <>
              El módulo <code>module.appointments</code> no está habilitado para este workspace.
            </>
          )}
        </p>
      </section>
    );
  }

  if ("error" in calendarWindow && calendarWindow.error)
    return (
      <section className={styles.errorState} role="alert">
        <h1>No se pudo preparar el calendario</h1>
        <p>{calendarWindow.error}</p>
        <button
          onClick={() =>
            setDateKey(dateKeyInZone(new Date(), bootstrap.tenant.defaultTimezone || "UTC"))
          }
          type="button"
        >
          Volver a hoy
        </button>
      </section>
    );

  const appointmentsByDay = groupAppointmentsByVisibleDay(appointments, calendarWindow.days, zone);
  const selectedService = services.find(({ id }) => id === selectedServiceId) ?? null;
  const selectedResource = resources.find(({ id }) => id === selectedResourceId) ?? null;
  const showWriteActions = capabilities.canManageAppointments;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Operación · Citas</p>
          <h1>Agenda</h1>
          <p>Consulta horarios, administra reservas y disponibilidad de tu equipo.</p>
        </div>
        <div className={styles.headerActions}>
          {showWriteActions && (
            <button className={styles.primaryButton} onClick={openCreate} type="button">
              <span aria-hidden="true">＋</span> Nueva cita
            </button>
          )}
          {showWriteActions && (
            <button
              className={styles.secondaryButton}
              onClick={() => setDialog("config")}
              type="button"
            >
              Configurar agenda
            </button>
          )}
        </div>
      </header>

      {!showWriteActions && (
        <div className={styles.notice} role="status">
          Vista de solo lectura. Para crear, cancelar o reprogramar citas, solicita{" "}
          <code>appointments.manage</code>.
        </div>
      )}
      {lookupErrors.length > 0 && (
        <div className={styles.notice} role="status">
          <strong>Algunas listas opcionales no están disponibles.</strong>{" "}
          {lookupErrors.join(" · ")}
        </div>
      )}

      <section aria-label="Controles del calendario" className={styles.calendarToolbar}>
        <div className={styles.dateControls}>
          <button
            aria-label="Periodo anterior"
            className={styles.iconButton}
            onClick={() => navigateDate(-1)}
            type="button"
          >
            ‹
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => {
              setDateKey(dateKeyInZone(new Date(), zone));
              setPage(0);
            }}
            type="button"
          >
            Hoy
          </button>
          <button
            aria-label="Periodo siguiente"
            className={styles.iconButton}
            onClick={() => navigateDate(1)}
            type="button"
          >
            ›
          </button>
          <label className={styles.dateInput}>
            Fecha
            <input
              aria-label="Fecha de referencia"
              onChange={(event) => {
                setDateKey(event.target.value);
                setPage(0);
              }}
              type="date"
              value={dateKey}
            />
          </label>
          <strong className={styles.periodLabel}>
            {view === "day"
              ? dateLabel(dateKey, zone)
              : `${dateLabel(calendarWindow.days.at(0) ?? dateKey, zone)} – ${dateLabel(calendarWindow.days.at(-1) ?? dateKey, zone)}`}
          </strong>
        </div>
        <fieldset className={styles.viewSwitch}>
          <legend>Vista de calendario</legend>
          {(["day", "week", "list"] as const).map((item) => (
            <button
              aria-pressed={view === item}
              className={view === item ? styles.selectedView : ""}
              key={item}
              onClick={() => {
                setView(item);
                setPage(0);
              }}
              type="button"
            >
              {item === "day" ? "Día" : item === "week" ? "Semana" : "Lista"}
            </button>
          ))}
        </fieldset>
      </section>

      <section aria-label="Filtros de citas" className={styles.filters}>
        <label>
          Zona horaria
          <select
            onChange={(event) => {
              setZone(event.target.value);
              setFoldChoice(null);
              setPage(0);
            }}
            value={zone}
          >
            <option value={bootstrap.tenant.defaultTimezone}>
              {bootstrap.tenant.defaultTimezone} · zona del tenant
            </option>
            {units
              .filter(
                (unit) =>
                  unit.active &&
                  unit.timezone &&
                  unit.timezone !== bootstrap.tenant.defaultTimezone,
              )
              .map((unit) => (
                <option key={unit.id} value={unit.timezone ?? ""}>
                  {unit.timezone} · {unit.name}
                </option>
              ))}
            {zone !== "UTC" && <option value="UTC">UTC</option>}
          </select>
        </label>
        <label>
          Profesional o recurso
          <select
            onChange={(event) => {
              setResourceFilter(event.target.value);
              setPage(0);
            }}
            value={resourceFilter}
          >
            <option value="">Todos</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Servicio
          <select
            onChange={(event) => {
              setServiceFilter(event.target.value);
              setPage(0);
            }}
            value={serviceFilter}
          >
            <option value="">Todos</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </label>
        {capabilities.canLookupOrganizationUnits && (
          <label>
            Unidad organizativa
            <select
              onChange={(event) => {
                setUnitFilter(event.target.value);
                setPage(0);
              }}
              value={unitFilter}
            >
              <option value="">Todas</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Estado
          <select
            onChange={(event) => {
              setStatus(
                event.target.value as NonNullable<AppointmentListFilters["status"]> | "ALL",
              );
              setPage(0);
            }}
            value={status}
          >
            <option value="ALL">Todos</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {listError && (
        <div className={styles.errorBanner} role="alert">
          <span>{listError}</span>
          <button onClick={refreshList} type="button">
            Reintentar
          </button>
        </div>
      )}
      {loading ? (
        <div aria-live="polite" className={styles.loadingState}>
          Cargando citas…
        </div>
      ) : (
        <>
          {appointments.length === 0 ? (
            <section className={styles.emptyState}>
              <span aria-hidden="true">◷</span>
              <h2>No hay citas en este periodo</h2>
              <p>
                Prueba otra fecha o cambia los filtros. Las citas nuevas aparecerán aquí después de
                confirmarse en el servidor.
              </p>
              {showWriteActions && (
                <button className={styles.primaryButton} onClick={openCreate} type="button">
                  Crear una cita
                </button>
              )}
            </section>
          ) : view === "list" ? (
            <section className={styles.appointmentList} aria-label="Citas del periodo">
              {calendarWindow.days.map((day) => (
                <div className={styles.dayGroup} key={day}>
                  <h2>{dateLabel(day, zone)}</h2>
                  {(appointmentsByDay.get(day) ?? []).map(({ appointment, continuesFrom }) => (
                    <AppointmentCard
                      appointment={appointment}
                      continuesFrom={continuesFrom}
                      key={`${day}:${appointment.id}`}
                      onOpen={openDetail}
                      resources={resources}
                      services={services}
                      zone={zone}
                    />
                  ))}
                </div>
              ))}
            </section>
          ) : view === "day" ? (
            <section className={styles.dayView}>
              <h2>{dateLabel(calendarWindow.days.at(0) ?? dateKey, zone)}</h2>
              {appointments.map((item) => (
                <AppointmentCard
                  appointment={item}
                  continuesFrom={
                    dateKeyInZone(item.startsAt, zone) !== calendarWindow.days.at(0)
                      ? `${formatZoned(item.startsAt, zone)}–${formatZoned(item.endsAt, zone)}`
                      : null
                  }
                  key={item.id}
                  onOpen={openDetail}
                  resources={resources}
                  services={services}
                  zone={zone}
                />
              ))}
            </section>
          ) : (
            <section className={styles.weekGrid} aria-label="Calendario semanal">
              {calendarWindow.days.map((day) => (
                <div className={styles.weekDay} key={day}>
                  <h2>
                    <span>
                      {new Intl.DateTimeFormat("es-MX", {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(new Date(`${day}T12:00:00.000Z`))}
                    </span>
                    <strong>{day.slice(-2)}</strong>
                  </h2>
                  <div className={styles.weekAppointments}>
                    {(appointmentsByDay.get(day) ?? []).map(({ appointment, continuesFrom }) => (
                      <AppointmentCard
                        compact
                        appointment={appointment}
                        continuesFrom={continuesFrom}
                        key={`${day}:${appointment.id}`}
                        onOpen={openDetail}
                        resources={resources}
                        services={services}
                        zone={zone}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          <Pager page={page} total={total} onChange={setPage} />
        </>
      )}

      {dialog === "create" && (
        <Modal disableClose={busy} onClose={closeDialog} title="Nueva cita" wide>
          <div className={styles.formBody}>
            {!capabilities.canLookupContacts ? (
              <div className={styles.warning} role="status">
                Para seleccionar clientes necesitas <code>module.crm_lite</code> y{" "}
                <code>contacts.read</code>. No se permite capturar un ID de contacto manualmente.
              </div>
            ) : (
              <div className={styles.field}>
                <label htmlFor="appointment-contact-search">Cliente</label>
                {selectedContact ? (
                  <div className={styles.selectedContact}>
                    <span>
                      <strong>{selectedContact.name}</strong>
                      <small>{selectedContact.phoneNumber}</small>
                    </span>
                    <button
                      onClick={() => {
                        setSelectedContact(null);
                        setContactSearch("");
                        setContactPage(1);
                        setSelectedConversationId("");
                        setOffsets([]);
                      }}
                      type="button"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      autoComplete="off"
                      id="appointment-contact-search"
                      onChange={(event) => {
                        setContactSearch(event.target.value);
                        setContactPage(1);
                      }}
                      placeholder="Buscar por nombre o teléfono"
                      value={contactSearch}
                    />
                    {contactLoading && <small>Buscando contactos…</small>}
                    {contactError && (
                      <small className={styles.fieldError} role="alert">
                        {contactError}
                      </small>
                    )}
                    {contacts.length > 0 && (
                      <>
                        <div
                          className={styles.lookupList}
                          role="listbox"
                          aria-label="Resultados de contactos"
                        >
                          {contacts.map((contact) => (
                            <button
                              key={contact.id}
                              onClick={() => {
                                setSelectedContact(contact);
                                setContactSearch(contact.name);
                                setContacts([]);
                                setSelectedConversationId("");
                                setOffsets([]);
                              }}
                              role="option"
                              type="button"
                            >
                              <strong>{contact.name}</strong>
                              <span>{contact.phoneNumber}</span>
                            </button>
                          ))}
                        </div>
                        <div className={styles.lookupPager}>
                          <button
                            disabled={contactPage <= 1 || contactLoading}
                            onClick={() => setContactPage((current) => current - 1)}
                            type="button"
                          >
                            Anterior
                          </button>
                          <span>
                            Página {contactPage} de {Math.max(1, Math.ceil(contactTotal / 20))} ·{" "}
                            {contactTotal} contactos
                          </span>
                          <button
                            disabled={contactPage >= Math.ceil(contactTotal / 20) || contactLoading}
                            onClick={() => setContactPage((current) => current + 1)}
                            type="button"
                          >
                            Siguiente
                          </button>
                        </div>
                      </>
                    )}
                    {contactSearch.trim().length > 0 && contactSearch.trim().length < 2 && (
                      <small>Escribe al menos 2 caracteres.</small>
                    )}
                  </>
                )}
              </div>
            )}
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="appointment-service-search">Servicio</label>
                {selectedService ? (
                  <div className={styles.selectedContact}>
                    <span>
                      <strong>{selectedService.name}</strong>
                      <small>
                        {selectedService.durationMinutes} min · márgenes{" "}
                        {selectedService.bufferBeforeMinutes}/{selectedService.bufferAfterMinutes}{" "}
                        min
                      </small>
                    </span>
                    <button
                      onClick={() => {
                        invalidateAvailability();
                        setSelectedServiceId("");
                        setServiceSearch("");
                        setChosenSlot(null);
                        setSlots([]);
                      }}
                      type="button"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      autoComplete="off"
                      id="appointment-service-search"
                      onChange={(event) => setServiceSearch(event.target.value)}
                      placeholder="Buscar servicio"
                      value={serviceSearch}
                    />
                    <div
                      className={styles.lookupList}
                      role="listbox"
                      aria-label="Servicios disponibles"
                    >
                      {activeServices
                        .filter((item) =>
                          item.name
                            .toLocaleLowerCase("es-MX")
                            .includes(serviceSearch.trim().toLocaleLowerCase("es-MX")),
                        )
                        .slice(0, 8)
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              invalidateAvailability();
                              setSelectedServiceId(item.id);
                              setServiceSearch(item.name);
                              setChosenSlot(null);
                              setSlots([]);
                            }}
                            role="option"
                            type="button"
                          >
                            <strong>{item.name}</strong>
                            <span>
                              {item.durationMinutes} min · márgenes {item.bufferBeforeMinutes}/
                              {item.bufferAfterMinutes} min
                            </span>
                          </button>
                        ))}
                    </div>
                    {activeServices.length === 0 && (
                      <small>No hay servicios activos disponibles.</small>
                    )}
                  </>
                )}
              </div>
              <div className={styles.field}>
                <label htmlFor="appointment-resource-search">Profesional o recurso</label>
                {selectedResource ? (
                  <div className={styles.selectedContact}>
                    <span>
                      <strong>{selectedResource.name}</strong>
                      <small>
                        {resourceTypeLabel(selectedResource.type)} · capacidad{" "}
                        {selectedResource.capacity}
                      </small>
                    </span>
                    <button
                      onClick={() => {
                        invalidateAvailability();
                        setSelectedResourceId("");
                        setResourceSearch("");
                        setChosenSlot(null);
                        setSlots([]);
                      }}
                      type="button"
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      autoComplete="off"
                      id="appointment-resource-search"
                      onChange={(event) => setResourceSearch(event.target.value)}
                      placeholder="Buscar recurso"
                      value={resourceSearch}
                    />
                    <div
                      className={styles.lookupList}
                      role="listbox"
                      aria-label="Recursos disponibles"
                    >
                      {activeResources
                        .filter((item) =>
                          item.name
                            .toLocaleLowerCase("es-MX")
                            .includes(resourceSearch.trim().toLocaleLowerCase("es-MX")),
                        )
                        .slice(0, 8)
                        .map((item) => (
                          <button
                            key={item.id}
                            onClick={() => {
                              invalidateAvailability();
                              setSelectedResourceId(item.id);
                              setResourceSearch(item.name);
                              setChosenSlot(null);
                              setSlots([]);
                            }}
                            role="option"
                            type="button"
                          >
                            <strong>{item.name}</strong>
                            <span>
                              {resourceTypeLabel(item.type)} · capacidad {item.capacity}
                            </span>
                          </button>
                        ))}
                    </div>
                    {activeResources.length === 0 && (
                      <small>No hay recursos activos disponibles.</small>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className={styles.formGrid}>
              <label>
                Fecha y hora local
                <input
                  onChange={(event) => {
                    invalidateAvailability();
                    setLocalStart(event.target.value);
                    setFoldChoice(null);
                    setChosenSlot(null);
                  }}
                  type="datetime-local"
                  value={localStart}
                />
              </label>
              <label>
                Zona horaria
                <select
                  onChange={(event) => {
                    invalidateAvailability();
                    setZone(event.target.value);
                    setFoldChoice(null);
                    setChosenSlot(null);
                  }}
                  value={zone}
                >
                  <option value={bootstrap.tenant.defaultTimezone}>
                    {bootstrap.tenant.defaultTimezone}
                  </option>
                  {units
                    .filter((unit) => unit.active && unit.timezone)
                    .map((unit) => (
                      <option key={unit.id} value={unit.timezone ?? ""}>
                        {unit.timezone} · {unit.name}
                      </option>
                    ))}
                  {zone !== "UTC" && <option value="UTC">UTC</option>}
                </select>
              </label>
            </div>
            {localStart && safeResolveLocalTime(localStart, zone).length > 1 && (
              <fieldset className={styles.foldChoice}>
                <legend>Esta hora ocurre dos veces por el cambio de horario. Elige una.</legend>
                {safeResolveLocalTime(localStart, zone).map((instant, index) => (
                  <label key={instant}>
                    <input
                      checked={foldChoice === index}
                      name="fold-choice"
                      onChange={() => {
                        invalidateAvailability();
                        setFoldChoice(index);
                      }}
                      type="radio"
                    />
                    {formatZoned(instant, zone)} · {new Date(instant).toISOString()}
                  </label>
                ))}
              </fieldset>
            )}
            <p className={styles.helperText}>
              La búsqueda consulta disponibilidad real hasta 168 horas a partir de esta hora. El
              servidor confirma la reserva y vuelve a validar capacidad al guardar.
            </p>
            <button
              className={styles.secondaryButton}
              disabled={!selectedServiceId || !selectedResourceId || !localStart || slotLoading}
              onClick={() => void searchSlots()}
              type="button"
            >
              {slotLoading ? "Consultando horarios…" : "Buscar horarios disponibles"}
            </button>
            {slotError && (
              <p className={styles.fieldError} role="alert">
                {slotError}
              </p>
            )}
            {slots.length > 0 && (
              <AvailabilitySlotPicker
                name="available-slot"
                onPageChange={setSlotPage}
                onSelect={setChosenSlot}
                page={slotPage}
                resources={resources}
                selected={chosenSlot}
                slots={slots}
                title="Selecciona un horario"
                zone={zone}
              />
            )}
            <label className={styles.field}>
              Notas internas
              <textarea
                maxLength={2000}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                value={notes}
              />
            </label>
            {capabilities.canConfigureReminders ? (
              <fieldset className={styles.reminderOptions}>
                <legend>Recordatorios automáticos (opcional)</legend>
                {!capabilities.canLookupConversations ? (
                  <p>
                    Para elegir una conversación se requiere <code>conversations.read</code>, además
                    de los módulos de Agenda, Programación, Mensajería y Contactos.
                  </p>
                ) : (
                  <>
                    <label>
                      Conversación del cliente
                      <select
                        disabled={conversationLoading || selectedContact === null}
                        onChange={(event) => {
                          setSelectedConversationId(event.target.value);
                          if (!event.target.value) setOffsets([]);
                        }}
                        value={selectedConversationId}
                      >
                        <option value="">Sin recordatorio</option>
                        {conversationOptions.map((conversation) => (
                          <option key={conversation.id} value={conversation.id}>
                            {conversation.channelAccount.name} · {conversation.status} ·{" "}
                            {conversation.automationMode}
                          </option>
                        ))}
                      </select>
                    </label>
                    {conversationLookupError && (
                      <p className={styles.fieldError} role="status">
                        {conversationLookupError} Puedes guardar la cita sin recordatorios.
                      </p>
                    )}
                    <div className={styles.offsets}>
                      {[
                        [1440, "24 horas antes"],
                        [60, "1 hora antes"],
                        [30, "30 minutos antes"],
                      ].map(([offset, label]) => (
                        <label key={offset as number}>
                          <input
                            checked={offsets.includes(offset as number)}
                            disabled={!selectedConversationId || conversationLoading}
                            onChange={(event) =>
                              setOffsets((current) =>
                                event.target.checked
                                  ? [...current, offset as number].slice(0, 3)
                                  : current.filter((item) => item !== offset),
                              )
                            }
                            type="checkbox"
                          />
                          {label as string}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p>
                  El envío automático sólo ocurre en modo AUTO. Los offsets vencidos quedan
                  registrados como omitidos; una reprogramación hereda la política y suprime los
                  recordatorios pendientes anteriores.
                </p>
              </fieldset>
            ) : (
              <div className={styles.warning}>
                Los recordatorios requieren los módulos Agenda, Programación, Mensajería y
                Contactos.
              </div>
            )}
            <div className={styles.formActions}>
              <button className={styles.secondaryButton} onClick={closeDialog} type="button">
                Cerrar
              </button>
              <button
                className={styles.primaryButton}
                disabled={
                  !capabilities.canManageAppointments || !selectedContact || !chosenSlot || busy
                }
                onClick={() => void saveAppointment()}
                type="button"
              >
                {busy ? "Guardando…" : "Confirmar cita"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog === "detail" && (
        <Modal
          disableClose={busy}
          modal={!confirmCancel}
          onClose={closeDialog}
          title="Detalle de la cita"
          wide
        >
          <div className={styles.formBody}>
            {detailLoading && <p aria-live="polite">Cargando detalle…</p>}
            {detailError && (
              <div className={styles.errorBanner} role="alert">
                {detailError}
              </div>
            )}
            {detail && (
              <>
                <div className={styles.detailHeading}>
                  <div>
                    <StatusBadge status={detail.status} />
                    <h3>{services.find(({ id }) => id === detail.serviceId)?.name ?? "Cita"}</h3>
                    <p>
                      {resources.find(({ id }) => id === detail.resourceId)?.name ??
                        "Recurso no disponible"}
                    </p>
                  </div>
                  <strong>{formatZoned(detail.startsAt, detail.timezoneSnapshot)}</strong>
                </div>
                <dl className={styles.detailGrid}>
                  <div>
                    <dt>Cliente</dt>
                    <dd>
                      {detailContact
                        ? `${detailContact.name} · ${detailContact.phoneNumber}`
                        : capabilities.canLookupContacts
                          ? "Contacto asociado"
                          : "Cliente asociado"}
                    </dd>
                  </div>
                  <div>
                    <dt>Duración</dt>
                    <dd>{detail.durationMinutes} minutos</dd>
                  </div>
                  <div>
                    <dt>Zona del registro</dt>
                    <dd>{detail.timezoneSnapshot}</dd>
                  </div>
                  <div>
                    <dt>Finaliza</dt>
                    <dd>{formatZoned(detail.endsAt, detail.timezoneSnapshot)}</dd>
                  </div>
                  <div>
                    <dt>Confirmación</dt>
                    <dd>
                      {detail.confirmationStatus === "CONFIRMED" ? "Confirmada" : "Pendiente"}
                    </dd>
                  </div>
                  <div>
                    <dt>Referencia</dt>
                    <dd>
                      {detail.rescheduledFromId
                        ? "Reprogramada desde una cita anterior"
                        : detail.status === "RESCHEDULED"
                          ? "Cita original; el nuevo registro tiene su propio historial"
                          : "Reserva original"}
                    </dd>
                  </div>
                </dl>
                {detail.notes && (
                  <div className={styles.notesBlock}>
                    <h4>Notas internas</h4>
                    <p>{detail.notes}</p>
                  </div>
                )}
                <section className={styles.reminderHistory}>
                  <h3>Historial de recordatorios</h3>
                  {reminders.length === 0 ? (
                    <p>No hay recordatorios registrados.</p>
                  ) : (
                    reminders.map((reminder) => (
                      <article key={reminder.id}>
                        <div>
                          <strong>{reminder.offsetMinutes} min antes</strong>
                          <span>{formatZoned(reminder.dueAt, detail.timezoneSnapshot)}</span>
                        </div>
                        <div>
                          <span>Recordatorio: {reminder.status}</span>
                          <span>Tarea: {reminder.taskStatus ?? "Sin tarea"}</span>
                          <span>Envío: {reminder.outboundStatus ?? "Sin envío"}</span>
                        </div>
                        {reminder.reason && <p role="status">{reminder.reason}</p>}
                        {(reminder.outboundStatus?.toUpperCase() === "QUEUED" ||
                          reminder.status.toUpperCase() === "QUEUED") && (
                          <small>En cola; todavía no confirma entrega.</small>
                        )}
                      </article>
                    ))
                  )}
                </section>
                {actionError && (
                  <div className={styles.errorBanner} role="alert">
                    {actionError}
                  </div>
                )}
                {rebookMode && (
                  <section className={styles.rebookPanel}>
                    <h3>Elegir nuevo horario</h3>
                    <p>
                      El nuevo registro conserva servicio y cliente; la política de recordatorios se
                      hereda y los recordatorios pendientes de esta cita se suprimen.
                    </p>
                    <div className={styles.formGrid}>
                      <label>
                        Fecha y hora local · {detail.timezoneSnapshot}
                        <input
                          onChange={(event) => {
                            invalidateAvailability();
                            setLocalStart(event.target.value);
                            setFoldChoice(null);
                            setChosenSlot(null);
                          }}
                          type="datetime-local"
                          value={localStart}
                        />
                      </label>
                      <label>
                        Recurso
                        <select
                          onChange={(event) => {
                            invalidateAvailability();
                            setSelectedResourceId(event.target.value);
                            setChosenSlot(null);
                          }}
                          value={selectedResourceId}
                        >
                          <option value="">Recurso original</option>
                          {activeResources.map((resource) => (
                            <option key={resource.id} value={resource.id}>
                              {resource.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <small>Zona horaria de la cita: {detail.timezoneSnapshot}</small>
                    {localStart &&
                      safeResolveLocalTime(localStart, detail.timezoneSnapshot).length > 1 && (
                        <fieldset className={styles.foldChoice}>
                          <legend>
                            Esta hora ocurre dos veces por el cambio de horario. Elige una.
                          </legend>
                          {safeResolveLocalTime(localStart, detail.timezoneSnapshot).map(
                            (instant, index) => (
                              <label key={instant}>
                                <input
                                  checked={foldChoice === index}
                                  name="rebook-fold"
                                  onChange={() => {
                                    invalidateAvailability();
                                    setFoldChoice(index);
                                  }}
                                  type="radio"
                                />
                                {formatZoned(instant, detail.timezoneSnapshot)} ·{" "}
                                {new Date(instant).toISOString()}
                              </label>
                            ),
                          )}
                        </fieldset>
                      )}
                    <button
                      className={styles.secondaryButton}
                      disabled={!localStart || !detail.resourceId || slotLoading}
                      onClick={() => {
                        const resourceId = selectedResourceId || detail.resourceId || "";
                        invalidateAvailability();
                        setSelectedServiceId(detail.serviceId);
                        setSelectedResourceId(resourceId);
                        void searchSlots(detail.serviceId, resourceId, detail.timezoneSnapshot);
                      }}
                      type="button"
                    >
                      {slotLoading ? "Consultando…" : "Consultar disponibilidad"}
                    </button>
                    {slotError && (
                      <p className={styles.fieldError} role="alert">
                        {slotError}
                      </p>
                    )}
                    {slots.length > 0 && (
                      <AvailabilitySlotPicker
                        name="rebook-slot"
                        onPageChange={setSlotPage}
                        onSelect={setChosenSlot}
                        page={slotPage}
                        resources={resources}
                        selected={chosenSlot}
                        slots={slots}
                        title="Selecciona el nuevo horario"
                        zone={detail.timezoneSnapshot}
                      />
                    )}
                  </section>
                )}
                <div className={styles.formActions}>
                  {capabilities.canManageAppointments &&
                    ["REQUESTED", "CONFIRMED"].includes(detail.status) && (
                      <>
                        <button
                          className={styles.secondaryButton}
                          disabled={busy}
                          onClick={() => {
                            const opening = !rebookMode;
                            if (opening) {
                              invalidateAvailability();
                              beginCommandIntent(idempotency.current, `rebook:${detail.id}`);
                              setFoldChoice(null);
                              setChosenSlot(null);
                              setSlots([]);
                              setLocalStart(
                                formatLocalDateTime(detail.startsAt, detail.timezoneSnapshot),
                              );
                            }
                            setRebookMode(opening);
                          }}
                          type="button"
                        >
                          {rebookMode ? "Cerrar reprogramación" : "Reprogramar"}
                        </button>
                        {!rebookMode && (
                          <button
                            className={styles.dangerButton}
                            disabled={busy}
                            onClick={() => setConfirmCancel(true)}
                            type="button"
                          >
                            Cancelar cita
                          </button>
                        )}
                        {rebookMode && (
                          <button
                            className={styles.primaryButton}
                            disabled={!chosenSlot || busy}
                            onClick={() => void submitRebook()}
                            type="button"
                          >
                            Confirmar nuevo horario
                          </button>
                        )}
                      </>
                    )}
                </div>
                {confirmCancel && (
                  <AlertLayer
                    onEscape={() => setConfirmCancel(false)}
                    title="Confirmar cancelación"
                    titleId="appointment-cancel-title"
                  >
                    <p>
                      ¿Quieres cancelar esta cita? El historial se conservará y el servidor
                      suprimirá los recordatorios pendientes.
                    </p>
                    {actionError && (
                      <div className={styles.errorBanner} role="alert">
                        {actionError}
                      </div>
                    )}
                    <div className={styles.formActions}>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => setConfirmCancel(false)}
                        type="button"
                      >
                        Volver
                      </button>
                      <button
                        className={styles.dangerButton}
                        disabled={busy}
                        onClick={() => void cancelAppointment()}
                        type="button"
                      >
                        {busy ? "Cancelando…" : "Confirmar cancelación"}
                      </button>
                    </div>
                  </AlertLayer>
                )}
              </>
            )}
          </div>
        </Modal>
      )}

      {dialog === "config" && (
        <AppointmentConfiguration
          api={api}
          canManage={capabilities.canManageAppointments}
          canLookupUnits={capabilities.canLookupOrganizationUnits}
          onClose={closeDialog}
          onCommitted={() => {
            refreshList();
            void reloadCatalogs(api, setServices, setResources);
          }}
          units={units}
          resources={resources}
          services={services}
        />
      )}
      {toast && (
        <div aria-live="polite" className={styles.toast} role="status">
          <span>{toast}</span>
          <button aria-label="Cerrar aviso" onClick={() => setToast(null)} type="button">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function groupAppointmentsByVisibleDay(
  appointments: readonly AppointmentItem[],
  days: readonly string[],
  zone: string,
): Map<string, Array<{ appointment: AppointmentItem; continuesFrom: string | null }>> {
  const grouped = new Map<
    string,
    Array<{ appointment: AppointmentItem; continuesFrom: string | null }>
  >();
  for (const appointment of appointments) {
    const startDate = dateKeyInZone(appointment.startsAt, zone);
    const overlappingDays = getVisibleAppointmentDays(
      appointment.startsAt,
      appointment.endsAt,
      days,
      zone,
    );
    const daysToShow =
      overlappingDays.length > 0 ? overlappingDays : days.includes(startDate) ? [startDate] : [];
    for (const day of daysToShow) {
      const rows = grouped.get(day) ?? [];
      rows.push({
        appointment,
        continuesFrom:
          day === startDate
            ? null
            : `${formatZoned(appointment.startsAt, zone)}–${formatZoned(appointment.endsAt, zone)}`,
      });
      grouped.set(day, rows);
    }
  }
  for (const rows of grouped.values())
    rows.sort((left, right) => left.appointment.startsAt.localeCompare(right.appointment.startsAt));
  return grouped;
}

function AppointmentCard({
  appointment,
  services,
  resources,
  zone,
  continuesFrom = null,
  onOpen,
  compact = false,
}: Readonly<{
  appointment: AppointmentItem;
  services: readonly ServiceItem[];
  resources: readonly ResourceItem[];
  zone: string;
  continuesFrom?: string | null;
  onOpen: (id: string) => void;
  compact?: boolean;
}>) {
  return (
    <button
      className={`${styles.appointmentCard}${compact ? ` ${styles.compactCard}` : ""}`}
      onClick={() => onOpen(appointment.id)}
      type="button"
    >
      <span className={styles.cardTime}>
        {timeLabel(appointment.startsAt, zone)}
        {continuesFrom && <small>Continúa · horario original {continuesFrom}</small>}
        <small>{appointment.durationMinutes} min</small>
      </span>
      <span className={styles.cardContent}>
        <strong>
          {services.find(({ id }) => id === appointment.serviceId)?.name ?? "Servicio"}
        </strong>
        <span>
          {resources.find(({ id }) => id === appointment.resourceId)?.name ?? "Recurso sin asignar"}
        </span>
      </span>
      <StatusBadge status={appointment.status} />
    </button>
  );
}

function AvailabilitySlotPicker({
  slots,
  selected,
  page,
  onPageChange,
  onSelect,
  name,
  title,
  zone,
  resources,
}: Readonly<{
  slots: readonly AvailabilitySlot[];
  selected: AvailabilitySlot | null;
  page: number;
  onPageChange: (page: number) => void;
  onSelect: (slot: AvailabilitySlot) => void;
  name: string;
  title: string;
  zone: string;
  resources: readonly ResourceItem[];
}>) {
  const pageCount = Math.max(1, Math.ceil(slots.length / SLOT_DISPLAY_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleSlots = slots.slice(
    safePage * SLOT_DISPLAY_PAGE_SIZE,
    (safePage + 1) * SLOT_DISPLAY_PAGE_SIZE,
  );
  const firstSlot = slots.length === 0 ? 0 : safePage * SLOT_DISPLAY_PAGE_SIZE + 1;
  const lastSlot = Math.min(slots.length, (safePage + 1) * SLOT_DISPLAY_PAGE_SIZE);
  const selectedResource = selected
    ? resources.find(({ id }) => id === selected.resourceId)?.name
    : null;

  return (
    <>
      <fieldset className={styles.slotChoices}>
        <legend>
          {title} · {zone}
        </legend>
        {visibleSlots.map((slot) => (
          <label
            className={selected?.startsAt === slot.startsAt ? styles.slotSelected : ""}
            key={`${slot.resourceId}:${slot.startsAt}`}
          >
            <input
              checked={selected?.startsAt === slot.startsAt}
              name={name}
              onChange={() => onSelect(slot)}
              type="radio"
            />
            <span>
              <strong>{formatZoned(slot.startsAt, zone)}</strong>
              <small>
                {formatZoned(slot.startsAt, zone)} – {formatZoned(slot.endsAt, zone)} · capacidad{" "}
                {slot.capacity}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <nav aria-label="Paginación de horarios" className={styles.slotPagination}>
        <span aria-live="polite">
          Horarios {firstSlot}–{lastSlot} de {slots.length} · Página {safePage + 1} de {pageCount}
        </span>
        <div>
          <button
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
            type="button"
          >
            Anteriores
          </button>
          <button
            disabled={safePage + 1 >= pageCount}
            onClick={() => onPageChange(safePage + 1)}
            type="button"
          >
            Siguientes
          </button>
        </div>
      </nav>
      <div aria-live="polite" className={styles.slotSummary} role="status">
        {selected ? (
          <>
            <strong>Horario seleccionado</strong>
            <span>
              {formatZoned(selected.startsAt, zone)} – {formatZoned(selected.endsAt, zone)}
              {selectedResource ? ` · ${selectedResource}` : ""} · capacidad {selected.capacity}
            </span>
          </>
        ) : (
          <span>Elige un horario para continuar.</span>
        )}
      </div>
    </>
  );
}

async function reloadCatalogs(
  api: ReturnType<typeof createAppointmentsApi>,
  setServices: (items: readonly ServiceItem[]) => void,
  setResources: (items: readonly ResourceItem[]) => void,
): Promise<void> {
  const [serviceItems, resourceItems] = await Promise.all([
    listAllServices(api),
    listAllResources(api),
  ]);
  setServices(serviceItems);
  setResources(resourceItems);
}

async function listAllServices(api: ConfigApi, signal?: AbortSignal): Promise<ServiceItem[]> {
  const items: ServiceItem[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const page = await api.services.list(
      { limit: 100, offset: items.length },
      signal ? { signal } : undefined,
    );
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  }
  return items;
}

async function listAllResources(api: ConfigApi, signal?: AbortSignal): Promise<ResourceItem[]> {
  const items: ResourceItem[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (items.length < total) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    const page = await api.resources.list(
      { limit: 100, offset: items.length },
      signal ? { signal } : undefined,
    );
    items.push(...page.items);
    total = page.total;
    if (page.items.length === 0) break;
  }
  return items;
}

type ConfigApi = ReturnType<typeof createAppointmentsApi>;

function AppointmentConfiguration({
  api,
  canManage,
  canLookupUnits,
  onClose,
  onCommitted,
  units,
  resources,
  services,
}: Readonly<{
  api: ConfigApi;
  canManage: boolean;
  canLookupUnits: boolean;
  onClose: () => void;
  onCommitted: () => void;
  units: readonly OrganizationUnitItem[];
  resources: readonly ResourceItem[];
  services: readonly ServiceItem[];
}>) {
  const [panel, setPanel] = useState<ConfigPanel>("services");
  const [items, setItems] = useState<
    readonly (ServiceItem | ResourceItem | RuleItem | ExceptionItem)[]
  >([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editable>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [removeItem, setRemoveItem] = useState<Editable>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const pagination = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      const result =
        panel === "services"
          ? await api.services.list(
              { ...pagination, ...(search.trim() ? { search: search.trim() } : {}) },
              { signal: controller.signal },
            )
          : panel === "resources"
            ? await api.resources.list(
                { ...pagination, ...(search.trim() ? { search: search.trim() } : {}) },
                { signal: controller.signal },
              )
            : panel === "rules"
              ? await api.rules.list({ ...pagination }, { signal: controller.signal })
              : await api.exceptions.list({ ...pagination }, { signal: controller.signal });
      setItems(result.items);
      setTotal(result.total);
    } catch (loadError) {
      if (!(loadError instanceof Error && loadError.name === "AbortError"))
        setError(apiErrorMessage(loadError));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [api, page, panel, search]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);
  const changePanel = (next: ConfigPanel) => {
    setPanel(next);
    setPage(0);
    setSearch("");
    setEditing(null);
    setFormOpen(false);
    setFormError(null);
  };

  if (!canManage)
    return (
      <Modal onClose={onClose} title="Configuración de agenda">
        <p className={styles.warning}>
          Se requiere <code>appointments.manage</code> para administrar catálogos, reglas y
          excepciones.
        </p>
      </Modal>
    );

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFormError(null);
    try {
      if (panel === "services") {
        const payload = {
          name: String(form.get("name") ?? "").trim(),
          description: String(form.get("description") ?? "").trim() || null,
          durationMinutes: Number(form.get("durationMinutes")),
          bufferBeforeMinutes: Number(form.get("bufferBeforeMinutes") || 0),
          bufferAfterMinutes: Number(form.get("bufferAfterMinutes") || 0),
          price: String(form.get("price") ?? "").trim() || null,
          currency: String(form.get("currency") ?? "MXN")
            .trim()
            .toUpperCase(),
          organizationUnitId: resolveAssociationPatch(
            editing && "organizationUnitId" in editing ? editing.organizationUnitId : null,
            canLookupUnits,
            String(form.get("organizationUnitId") ?? ""),
          ),
        };
        if (editing)
          await api.services.update(editing.id, {
            ...payload,
            active: form.get("active") === "on",
          });
        else await api.services.create(payload);
      } else if (panel === "resources") {
        const payload: AppointmentResourceInput = {
          name: String(form.get("name") ?? "").trim(),
          type: String(form.get("type") ?? "OTHER") as NonNullable<
            AppointmentResourceInput["type"]
          >,
          description: String(form.get("description") ?? "").trim() || null,
          capacity: Number(form.get("capacity") || 1),
          organizationUnitId: resolveAssociationPatch(
            editing && "organizationUnitId" in editing ? editing.organizationUnitId : null,
            canLookupUnits,
            String(form.get("organizationUnitId") ?? ""),
          ),
        };
        if (editing)
          await api.resources.update(editing.id, {
            ...payload,
            active: form.get("active") === "on",
          });
        else await api.resources.create(payload);
      } else if (panel === "rules") {
        const resourceId = String(form.get("resourceId") ?? "");
        const endTime = String(form.get("endTime") ?? "");
        const payload = {
          resourceId,
          serviceId: String(form.get("serviceId") ?? "") || null,
          dayOfWeek: Number(form.get("dayOfWeek")),
          startTime: String(form.get("startTime") ?? ""),
          endTime,
          timezone: String(form.get("timezone") ?? "").trim() || null,
          effectiveFrom: String(form.get("effectiveFrom") ?? "") || null,
          effectiveTo: String(form.get("effectiveTo") ?? "") || null,
          capacity: Number(form.get("capacity") || 1),
        };
        if (editing)
          await api.rules.update(editing.id, {
            serviceId: payload.serviceId,
            dayOfWeek: payload.dayOfWeek,
            startTime: payload.startTime,
            endTime: payload.endTime,
            timezone: payload.timezone,
            effectiveFrom: payload.effectiveFrom,
            effectiveTo: payload.effectiveTo,
            capacity: payload.capacity,
            active: form.get("active") === "on",
          });
        else await api.rules.create(payload);
      } else {
        const localFrom = String(form.get("startsAt") ?? "");
        const localTo = String(form.get("endsAt") ?? "");
        const timezone = String(form.get("timezone") || "UTC");
        const starts = resolveLocalTime(localFrom, timezone);
        const ends = resolveLocalTime(localTo, timezone);
        const startIndex = Number(form.get("startFold") || 0);
        const endIndex = Number(form.get("endFold") || 0);
        if (starts.length === 0 || ends.length === 0)
          throw new Error(
            "La hora elegida no existe en esta zona por el cambio de horario. Corrige la fecha u hora.",
          );
        if (starts.length > 1 && !form.has("startFoldChosen"))
          throw new Error("Elige el desplazamiento correcto para la hora de inicio duplicada.");
        if (ends.length > 1 && !form.has("endFoldChosen"))
          throw new Error("Elige el desplazamiento correcto para la hora final duplicada.");
        const editingException = editing && "startsAt" in editing ? editing : null;
        const startsAt =
          editingException &&
          timezone === "UTC" &&
          localFrom === formatLocalDateTime(editingException.startsAt, "UTC")
            ? editingException.startsAt
            : starts[Math.min(startIndex, starts.length - 1)];
        const endsAt =
          editingException &&
          timezone === "UTC" &&
          localTo === formatLocalDateTime(editingException.endsAt, "UTC")
            ? editingException.endsAt
            : ends[Math.min(endIndex, ends.length - 1)];
        if (!startsAt || !endsAt)
          throw new Error("Elige una fecha y hora válidas para esta excepción.");
        const payload = {
          resourceId: String(form.get("resourceId") ?? ""),
          type: String(form.get("type") ?? "BLOCKED") as "BLOCKED" | "EXTRA_AVAILABILITY",
          startsAt,
          endsAt,
          reason: String(form.get("reason") ?? "").trim() || null,
        };
        if (Date.parse(payload.startsAt) >= Date.parse(payload.endsAt))
          throw new Error("La hora final debe ser posterior a la inicial.");
        if (editing)
          await api.exceptions.update(editing.id, {
            type: payload.type,
            startsAt: payload.startsAt,
            endsAt: payload.endsAt,
            reason: payload.reason,
            active: form.get("active") === "on",
          });
        else await api.exceptions.create(payload);
      }
      setEditing(null);
      setFormOpen(false);
      await load();
      onCommitted();
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removeItem) return;
    setBusy(true);
    setFormError(null);
    try {
      if (panel === "services") await api.services.remove(removeItem.id);
      else if (panel === "resources") await api.resources.remove(removeItem.id);
      else if (panel === "rules") await api.rules.remove(removeItem.id);
      else await api.exceptions.remove(removeItem.id);
      setRemoveItem(null);
      await load();
      onCommitted();
    } catch (removeError) {
      setFormError(apiErrorMessage(removeError));
    } finally {
      setBusy(false);
    }
  };

  const itemName = (item: Editable): string => {
    if (!item) return "este registro";
    if ("name" in item) return item.name;
    if ("dayOfWeek" in item)
      return `${WEEKDAYS[item.dayOfWeek]} · ${item.startTime}–${item.endTime}`;
    return `${item.type === "BLOCKED" ? "Bloqueo" : "Disponibilidad adicional"} · ${formatZoned(item.startsAt, "UTC")}`;
  };

  return (
    <Modal modal={removeItem === null} onClose={onClose} title="Configuración de agenda" wide>
      <div className={styles.configLayout}>
        <nav aria-label="Configuración de disponibilidad" className={styles.configTabs}>
          {(["services", "resources", "rules", "exceptions"] as const).map((item) => (
            <button
              aria-current={panel === item ? "page" : undefined}
              className={panel === item ? styles.configTabActive : ""}
              key={item}
              onClick={() => changePanel(item)}
              type="button"
            >
              {item === "services"
                ? "Servicios"
                : item === "resources"
                  ? "Recursos"
                  : item === "rules"
                    ? "Reglas semanales"
                    : "Excepciones"}
            </button>
          ))}
        </nav>
        <section className={styles.configPanel}>
          <div className={styles.configToolbar}>
            <div>
              <h3>
                {panel === "services"
                  ? "Servicios"
                  : panel === "resources"
                    ? "Recursos"
                    : panel === "rules"
                      ? "Reglas semanales"
                      : "Excepciones"}
              </h3>
              <p>
                {panel === "services"
                  ? "Duración, márgenes y precio de los servicios ofrecidos."
                  : panel === "resources"
                    ? "Profesionales, espacios y equipo disponibles."
                    : panel === "rules"
                      ? "Ventanas recurrentes para cada recurso."
                      : "Bloqueos y disponibilidad adicional en fechas concretas."}
              </p>
            </div>
            <button
              className={styles.primaryButton}
              onClick={() => {
                setEditing(null);
                setFormError(null);
                setFormOpen(true);
              }}
              type="button"
            >
              ＋ Nuevo
            </button>
          </div>
          {panel !== "rules" && panel !== "exceptions" && (
            <label className={styles.searchLabel}>
              Buscar
              <input
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                placeholder="Nombre"
                value={search}
              />
            </label>
          )}
          {error && (
            <div className={styles.errorBanner} role="alert">
              {error}
              <button onClick={() => void load()} type="button">
                Reintentar
              </button>
            </div>
          )}
          {formError && (
            <div className={styles.errorBanner} role="alert">
              {formError}
            </div>
          )}
          {loading ? (
            <p aria-live="polite">Cargando configuración…</p>
          ) : items.length === 0 ? (
            <p className={styles.configEmpty}>Aún no hay registros en esta sección.</p>
          ) : (
            <div className={styles.configList}>
              {items.map((item) => (
                <article className={styles.configRow} key={item.id}>
                  <div>
                    <strong>{itemName(item)}</strong>
                    <small>{configSummary(panel, item, resources, services)}</small>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      onClick={() => {
                        setEditing(item);
                        setFormError(null);
                        setFormOpen(true);
                      }}
                      type="button"
                    >
                      Editar
                    </button>
                    <button
                      className={styles.removeLink}
                      onClick={() => setRemoveItem(item)}
                      type="button"
                    >
                      {panel === "services" || panel === "resources" ? "Desactivar" : "Eliminar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <Pager page={page} total={total} onChange={setPage} />
          <ConfigForm
            editing={editing}
            open={formOpen}
            canLookupUnits={canLookupUnits}
            panel={panel}
            resources={resources}
            services={services}
            units={units}
            busy={busy}
            onCancel={() => {
              setEditing(null);
              setFormOpen(false);
              setFormError(null);
            }}
            onSubmit={save}
          />
        </section>
        {removeItem && (
          <AlertLayer
            onEscape={() => setRemoveItem(null)}
            title={
              panel === "services" || panel === "resources"
                ? "Desactivar registro"
                : "Eliminar disponibilidad"
            }
            titleId="appointment-config-remove-title"
          >
            <p>
              {panel === "services" || panel === "resources" ? (
                <>
                  Se desactivará <strong>{itemName(removeItem)}</strong>. No se borran citas ni
                  historial.
                </>
              ) : (
                <>
                  Se eliminará <strong>{itemName(removeItem)}</strong>. La operación requiere
                  confirmación.
                </>
              )}
            </p>
            <div>
              <button
                className={styles.secondaryButton}
                onClick={() => setRemoveItem(null)}
                type="button"
              >
                Volver
              </button>
              <button
                className={styles.dangerButton}
                disabled={busy}
                onClick={() => void remove()}
                type="button"
              >
                {busy
                  ? "Procesando…"
                  : panel === "services" || panel === "resources"
                    ? "Desactivar"
                    : "Eliminar"}
              </button>
            </div>
          </AlertLayer>
        )}
      </div>
    </Modal>
  );
}

function configSummary(
  panel: ConfigPanel,
  item: ServiceItem | ResourceItem | RuleItem | ExceptionItem,
  resources: readonly ResourceItem[],
  services: readonly ServiceItem[],
): string {
  if (panel === "services" && "durationMinutes" in item)
    return `${item.active ? "Activo" : "Inactivo"} · ${item.durationMinutes} min · ${item.bufferBeforeMinutes}/${item.bufferAfterMinutes} min de margen · ${item.price ? `${item.currency} ${item.price}` : "Sin precio"}`;
  if (panel === "resources" && "capacity" in item && "type" in item && "name" in item)
    return `${item.active ? "Activo" : "Inactivo"} · ${resourceTypeLabel(item.type)} · capacidad ${item.capacity}`;
  if (panel === "rules" && "dayOfWeek" in item)
    return `${item.active ? "Activa" : "Inactiva"} · ${resources.find(({ id }) => id === item.resourceId)?.name ?? "Recurso"} · ${item.serviceId ? (services.find(({ id }) => id === item.serviceId)?.name ?? "Servicio") : "Todos los servicios"} · ${item.timezone ?? "Zona del tenant"} · capacidad ${item.capacity}`;
  if (panel === "exceptions" && "startsAt" in item)
    return `${item.active ? "Activa" : "Inactiva"} · ${resources.find(({ id }) => id === item.resourceId)?.name ?? "Recurso"} · ${formatZoned(item.startsAt, "UTC")} – ${formatZoned(item.endsAt, "UTC")} UTC · ${item.reason ?? "Sin motivo"}`;
  return "";
}

function resourceTypeLabel(type: ResourceItem["type"]): string {
  return {
    PRACTITIONER: "Profesional",
    FACILITY: "Instalación",
    ROOM: "Consultorio",
    EQUIPMENT: "Equipo",
    OTHER: "Otro",
  }[type];
}

function ConfigForm({
  editing,
  open,
  canLookupUnits,
  panel,
  resources,
  services,
  units,
  busy,
  onCancel,
  onSubmit,
}: Readonly<{
  editing: Editable;
  open: boolean;
  canLookupUnits: boolean;
  panel: ConfigPanel;
  resources: readonly ResourceItem[];
  services: readonly ServiceItem[];
  units: readonly OrganizationUnitItem[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  const isEditing = editing !== null;
  const commonUnit =
    "organizationUnitId" in (editing ?? {})
      ? ((editing as ServiceItem | ResourceItem).organizationUnitId ?? "")
      : "";
  const [exceptionZone, setExceptionZone] = useState("UTC");
  const [exceptionFrom, setExceptionFrom] = useState("");
  const [exceptionTo, setExceptionTo] = useState("");
  const [exceptionStartFold, setExceptionStartFold] = useState<number | null>(null);
  const [exceptionEndFold, setExceptionEndFold] = useState<number | null>(null);
  useEffect(() => {
    if (!open || panel !== "exceptions") return;
    const item = editing && "startsAt" in editing ? editing : null;
    setExceptionZone("UTC");
    setExceptionFrom(item ? formatLocalDateTime(item.startsAt, "UTC") : "");
    setExceptionTo(item ? formatLocalDateTime(item.endsAt, "UTC") : "");
    setExceptionStartFold(null);
    setExceptionEndFold(null);
  }, [editing, open, panel]);
  if (!open) return null;
  if (
    (!isEditing && panel === "services") ||
    (isEditing && panel === "services" && "durationMinutes" in editing)
  ) {
    const item = editing as ServiceItem | null;
    return (
      <form className={styles.configForm} onSubmit={onSubmit}>
        <h4>{item ? "Editar servicio" : "Nuevo servicio"}</h4>
        <label>
          Nombre
          <input defaultValue={item?.name ?? ""} maxLength={120} name="name" required />
        </label>
        <label>
          Descripción
          <textarea
            defaultValue={item?.description ?? ""}
            maxLength={1000}
            name="description"
            rows={2}
          />
        </label>
        <div className={styles.formGrid}>
          <label>
            Duración (minutos)
            <input
              defaultValue={item?.durationMinutes ?? 30}
              min="1"
              name="durationMinutes"
              required
              type="number"
            />
          </label>
          <label>
            Margen antes (minutos)
            <input
              defaultValue={item?.bufferBeforeMinutes ?? 0}
              min="0"
              name="bufferBeforeMinutes"
              type="number"
            />
          </label>
          <label>
            Margen después (minutos)
            <input
              defaultValue={item?.bufferAfterMinutes ?? 0}
              min="0"
              name="bufferAfterMinutes"
              type="number"
            />
          </label>
          <label>
            Precio (opcional)
            <input
              defaultValue={item?.price ?? ""}
              min="0"
              name="price"
              step="0.01"
              type="number"
            />
          </label>
          <label>
            Moneda
            <input
              autoCapitalize="characters"
              defaultValue={item?.currency ?? "MXN"}
              maxLength={3}
              name="currency"
              pattern="[A-Za-z]{3}"
              required
              title="Usa el código de moneda de tres letras del servicio."
              type="text"
            />
          </label>
        </div>
        {canLookupUnits && (
          <label>
            Unidad organizativa (opcional)
            <select defaultValue={commonUnit} name="organizationUnitId">
              <option value="">Todas las unidades</option>
              {commonUnit && !units.some((unit) => unit.id === commonUnit && unit.active) && (
                <option value={commonUnit}>
                  {units.find((unit) => unit.id === commonUnit)?.name
                    ? `${units.find((unit) => unit.id === commonUnit)?.name} (inactiva)`
                    : "Unidad vinculada (inactiva o no disponible)"}
                </option>
              )}
              {units
                .filter((unit) => unit.active)
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {item && (
          <label className={styles.checkField}>
            <input defaultChecked={item.active} name="active" type="checkbox" />
            Servicio activo
          </label>
        )}
        <ConfigFormActions busy={busy} onCancel={onCancel} />
      </form>
    );
  }
  if (
    (!isEditing && panel === "resources") ||
    (isEditing && panel === "resources" && "capacity" in editing && "userId" in editing)
  ) {
    const item = editing as ResourceItem | null;
    return (
      <form className={styles.configForm} onSubmit={onSubmit}>
        <h4>{item ? "Editar recurso" : "Nuevo recurso"}</h4>
        <label>
          Nombre
          <input defaultValue={item?.name ?? ""} maxLength={120} name="name" required />
        </label>
        <div className={styles.formGrid}>
          <label>
            Tipo
            <select defaultValue={item?.type ?? "PRACTITIONER"} name="type">
              {RESOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {resourceTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Capacidad
            <input
              defaultValue={item?.capacity ?? 1}
              min="1"
              name="capacity"
              required
              type="number"
            />
          </label>
        </div>
        <label>
          Descripción
          <textarea
            defaultValue={item?.description ?? ""}
            maxLength={1000}
            name="description"
            rows={2}
          />
        </label>
        {canLookupUnits && (
          <label>
            Unidad organizativa (opcional)
            <select defaultValue={commonUnit} name="organizationUnitId">
              <option value="">Todas las unidades</option>
              {commonUnit && !units.some((unit) => unit.id === commonUnit && unit.active) && (
                <option value={commonUnit}>
                  {units.find((unit) => unit.id === commonUnit)?.name
                    ? `${units.find((unit) => unit.id === commonUnit)?.name} (inactiva)`
                    : "Unidad vinculada (inactiva o no disponible)"}
                </option>
              )}
              {units
                .filter((unit) => unit.active)
                .map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {item && (
          <label className={styles.checkField}>
            <input defaultChecked={item.active} name="active" type="checkbox" />
            Recurso activo
          </label>
        )}
        <ConfigFormActions busy={busy} onCancel={onCancel} />
      </form>
    );
  }
  if (
    (!isEditing && panel === "rules") ||
    (isEditing && panel === "rules" && "dayOfWeek" in editing)
  ) {
    const item = editing as RuleItem | null;
    return (
      <form className={styles.configForm} onSubmit={onSubmit}>
        <h4>{item ? "Editar regla semanal" : "Nueva regla semanal"}</h4>
        <div className={styles.formGrid}>
          {item ? (
            <label>
              Recurso
              <input
                readOnly
                value={
                  resources.find(({ id }) => id === item.resourceId)?.name ??
                  "Recurso no disponible"
                }
              />
            </label>
          ) : (
            <label>
              Recurso
              <select defaultValue="" name="resourceId" required>
                <option value="">Selecciona recurso</option>
                {resources
                  .filter((resource) => resource.active)
                  .map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Servicio (opcional)
            <select defaultValue={item?.serviceId ?? ""} name="serviceId">
              <option value="">Todos los servicios</option>
              {item?.serviceId &&
                !services.some((service) => service.id === item.serviceId && service.active) && (
                  <option value={item.serviceId}>
                    {services.find((service) => service.id === item.serviceId)?.name
                      ? `${services.find((service) => service.id === item.serviceId)?.name} (inactivo)`
                      : "Servicio vinculado (no disponible)"}
                  </option>
                )}
              {services
                .filter((service) => service.active)
                .map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
            </select>
            {item?.serviceId &&
              !services.some((service) => service.id === item.serviceId && service.active) && (
                <small role="status">
                  El servicio vinculado está inactivo o no disponible. Elige un servicio activo, o
                  actívalo antes de guardar esta regla.
                </small>
              )}
          </label>
          <label>
            Día
            <select defaultValue={item?.dayOfWeek ?? 1} name="dayOfWeek">
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zona horaria IANA (opcional)
            <input
              defaultValue={item?.timezone ?? ""}
              name="timezone"
              placeholder="America/Mexico_City"
            />
          </label>
          <label>
            Inicio
            <input
              defaultValue={item?.startTime ?? "09:00"}
              max="23:59"
              name="startTime"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
              required
              type="text"
            />
          </label>
          <label>
            Fin · HH:mm o 24:00
            <input
              defaultValue={item?.endTime ?? "17:00"}
              name="endTime"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00"
              required
              type="text"
            />
          </label>
        </div>
        <div className={styles.formGrid}>
          <label>
            Vigente desde (opcional)
            <input
              defaultValue={item?.effectiveFrom?.slice(0, 10) ?? ""}
              name="effectiveFrom"
              type="date"
            />
          </label>
          <label>
            Vigente hasta (opcional)
            <input
              defaultValue={item?.effectiveTo?.slice(0, 10) ?? ""}
              name="effectiveTo"
              type="date"
            />
          </label>
          <label>
            Capacidad
            <input defaultValue={item?.capacity ?? 1} min="1" name="capacity" type="number" />
          </label>
        </div>
        {item && (
          <label className={styles.checkField}>
            <input defaultChecked={item.active} name="active" type="checkbox" />
            Regla activa
          </label>
        )}
        <small>
          El recurso queda fijo al editar una regla. El inicio acepta 00:00–23:59; el final también
          puede ser 24:00.
        </small>
        <ConfigFormActions busy={busy} onCancel={onCancel} />
      </form>
    );
  }
  if (panel === "exceptions" && (!isEditing || "startsAt" in editing)) {
    const item = editing as ExceptionItem | null;
    const fromMatches = exceptionFrom ? safeResolveLocalTime(exceptionFrom, exceptionZone) : [];
    const toMatches = exceptionTo ? safeResolveLocalTime(exceptionTo, exceptionZone) : [];
    return (
      <form className={styles.configForm} onSubmit={onSubmit}>
        <h4>{item ? "Editar excepción" : "Nueva excepción"}</h4>
        <div className={styles.formGrid}>
          {item ? (
            <label>
              Recurso
              <input
                readOnly
                value={
                  resources.find(({ id }) => id === item.resourceId)?.name ??
                  "Recurso no disponible"
                }
              />
            </label>
          ) : (
            <label>
              Recurso
              <select defaultValue="" name="resourceId" required>
                <option value="">Selecciona recurso</option>
                {resources
                  .filter((resource) => resource.active)
                  .map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label>
            Tipo
            <select defaultValue={item?.type ?? "BLOCKED"} name="type">
              <option value="BLOCKED">Bloqueo</option>
              <option value="EXTRA_AVAILABILITY">Disponibilidad adicional</option>
            </select>
          </label>
        </div>
        <div className={styles.formGrid}>
          <label>
            Inicio local
            <input
              onChange={(event) => {
                setExceptionFrom(event.target.value);
                setExceptionStartFold(null);
              }}
              name="startsAt"
              required
              type="datetime-local"
              value={exceptionFrom}
            />
          </label>
          <label>
            Fin local
            <input
              onChange={(event) => {
                setExceptionTo(event.target.value);
                setExceptionEndFold(null);
              }}
              name="endsAt"
              required
              type="datetime-local"
              value={exceptionTo}
            />
          </label>
        </div>
        <label>
          Zona horaria IANA
          <input
            onChange={(event) => {
              setExceptionZone(event.target.value);
              setExceptionStartFold(null);
              setExceptionEndFold(null);
            }}
            name="timezone"
            required
            value={exceptionZone}
          />
        </label>
        {fromMatches.length > 1 && (
          <fieldset className={styles.foldChoice}>
            <legend>Inicio ambiguo: elige el offset</legend>
            {fromMatches.map((instant, index) => (
              <label key={instant}>
                <input
                  checked={exceptionStartFold === index}
                  name="startFoldChosen"
                  onChange={() => setExceptionStartFold(index)}
                  type="radio"
                  value={index}
                />
                {formatZoned(instant, exceptionZone)} · {new Date(instant).toISOString()}
              </label>
            ))}
            <input name="startFold" type="hidden" value={exceptionStartFold ?? ""} />
          </fieldset>
        )}
        {toMatches.length > 1 && (
          <fieldset className={styles.foldChoice}>
            <legend>Fin ambiguo: elige el offset</legend>
            {toMatches.map((instant, index) => (
              <label key={instant}>
                <input
                  checked={exceptionEndFold === index}
                  name="endFoldChosen"
                  onChange={() => setExceptionEndFold(index)}
                  type="radio"
                  value={index}
                />
                {formatZoned(instant, exceptionZone)} · {new Date(instant).toISOString()}
              </label>
            ))}
            <input name="endFold" type="hidden" value={exceptionEndFold ?? ""} />
          </fieldset>
        )}
        {fromMatches.length <= 1 && <input name="startFold" type="hidden" value="0" />}
        {toMatches.length <= 1 && <input name="endFold" type="hidden" value="0" />}
        <label>
          Motivo (opcional)
          <input defaultValue={item?.reason ?? ""} maxLength={255} name="reason" />
        </label>
        {item && (
          <label className={styles.checkField}>
            <input defaultChecked={item.active} name="active" type="checkbox" />
            Excepción activa
          </label>
        )}
        <small>
          Las horas inexistentes se rechazan con una indicación para corregirlas. Las horas ambiguas
          requieren un offset explícito; se enviarán instantes UTC.
        </small>
        <ConfigFormActions busy={busy} onCancel={onCancel} />
      </form>
    );
  }
  return null;
}

function safeResolveLocalTime(localDateTime: string, zone: string): string[] {
  try {
    return resolveLocalTime(localDateTime, zone);
  } catch {
    return [];
  }
}

function ConfigFormActions({ busy, onCancel }: Readonly<{ busy: boolean; onCancel: () => void }>) {
  return (
    <div className={styles.formActions}>
      <button className={styles.secondaryButton} onClick={onCancel} type="button">
        Cancelar
      </button>
      <button className={styles.primaryButton} disabled={busy} type="submit">
        {busy ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}
