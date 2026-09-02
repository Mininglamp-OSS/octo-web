import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FileArchive, ImagePlus, Loader2, UploadCloud, XCircle } from "lucide-react";
import { t, useI18n, WKButton, WKInput, WKModal } from "@octo/base";
import type { Category, NewSkillForm, Skill } from "../types/skill";
import { createSkill, updateSkill, createReviewRequest, getSkillTags, initReupload, initUpload, publishPlugin, uploadFile, uploadIcon, triggerParse, pollParse } from "../api/skillApi";
import { MAX_SKILL_TAGS, validateSkillTag, validateSkillTags } from "../utils/format";
import { getSkillAvatarColor, getSkillAvatarText } from "../utils/skillAvatar";
import IconCropModal from "./IconCropModal";
import InlineConfirmBar from "./InlineConfirmBar";
import { versionErrorKey } from "../utils/version";

/**
 * The visibility the author DECLARES on the plugin. It is stored as-is and lists
 * nothing on its own — 发布 is what lists it, and the backend decides from this
 * value whether that means listing immediately (private) or opening an
 * organization review (space).
 *
 * This replaces the old `SubmitScope` ("private" | "review"), which encoded the
 * routing decision in the client. Two problems with that: the client had to know
 * a rule the server owns, and the author's actual intent was thrown away — every
 * plugin was created `private` regardless of what they picked.
 *
 * 全平台 (`system`) is deliberately absent: the tenant API rejects it, it is
 * minted only through the marketplace-admin surface.
 */
type DeclaredVisibility = "private" | "space";

interface NewSkillModalProps {
  visible: boolean;
  categories: Category[];
  onClose: () => void;
  onCreated: (message?: string) => void;
  /** If set, opens in "submit review for an existing skill" mode.
   *  A private draft needs only version + changelog (the plugin row is itself
   *  the draft). An already-listed skill is an UPGRADE and must also upload the
   *  new package — that row is the live content, so submitting without new
   *  content would have the reviewer approve something that already shipped. */
  reviewSkill?: Skill | null;
  /** Pre-filled version/changelog for a resubmit after rejection. */
  reviewInitial?: { version?: string; changelog?: string } | null;
}

type UploadStage = "idle" | "uploading" | "parsing" | "form" | "review" | "error";

const MAX_ZIP_SIZE = 20 * 1024 * 1024;
const DEFAULT_CREATE_VERSION = "0.1.0";
const SKILL_PACKAGE_ACCEPT = ".zip,.skill";

function bumpPatch(ver: string): string {
  const parts = ver.split(".");
  if (parts.length < 3) return ver;
  const patch = parseInt(parts[2], 10);
  parts[2] = String(isNaN(patch) ? 1 : patch + 1);
  return parts.join(".");
}



function createReadme(name: string, description: string, version: string): string {
  return `# ${name}\n\n${description}\n\n## Version\n\n${version}\n`;
}

function validateZipFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".zip") && !name.endsWith(".skill")) return t("skillMarket.upload.invalidFormat");
  if (file.size > MAX_ZIP_SIZE) return t("skillMarket.upload.fileTooLarge");
  return null;
}

export default function NewSkillModal({ visible, categories, onClose, onCreated, reviewSkill, reviewInitial }: NewSkillModalProps) {
  useI18n();
  const selectableCategories = useMemo<Category[]>(
    () => categories.filter((category: Category) => category.id !== "all"),
    [categories],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iconInputRef = useRef<HTMLInputElement | null>(null);
  const tagFieldRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef(false);
  const [stage, setStage] = useState<UploadStage>("idle");
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [parseTaskId, setParseTaskId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [tagSuggestOpen, setTagSuggestOpen] = useState(false);
  const [tagSuggestionStyle, setTagSuggestionStyle] = useState<React.CSSProperties>({});
  const [activeTagSuggestion, setActiveTagSuggestion] = useState(0);
  const [tagError, setTagError] = useState<string | null>(null);
  const [version, setVersion] = useState(DEFAULT_CREATE_VERSION);
  const [changelog, setChangelog] = useState("");
  const [declaredVisibility, setDeclaredVisibility] = useState<DeclaredVisibility>("private");
  // Which footer button is in flight, so only that one shows a spinner.
  const [publishing, setPublishing] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconBlob, setIconBlob] = useState<Blob | null>(null);
  const [iconCropFile, setIconCropFile] = useState<File | null>(null);
  useEffect(() => {
    if (!iconPreview) return;
    return () => URL.revokeObjectURL(iconPreview);
  }, [iconPreview]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState<"busy" | "dirty" | null>(null);
  // Defect 1 fix: remember a successfully-created plugin id so a retry after a
  // failed createReviewRequest skips createSkill and only re-submits the
  // review. The user is told the draft was saved; no orphan is left behind.
  const [createdPluginId, setCreatedPluginId] = useState<string | null>(null);

  const isReviewMode = Boolean(reviewSkill);
  // An upgrade is a review submission for a skill that is ALREADY listed to the
  // org. Its plugin row is the live content, so the submission has to carry the
  // new package: without it the reviewer would be approving something that
  // shipped before they ever saw it. A private draft is the other case — nobody
  // else can see it, so the row is legitimately the thing under review.
  const isUpgrade = Boolean(reviewSkill && reviewSkill.visibility !== "private");
  const busy = stage === "uploading" || stage === "parsing";

  const reviewDefaultVersion = useMemo(() => {
    if (reviewInitial?.version) return reviewInitial.version;
    if (reviewSkill) return bumpPatch(reviewSkill.version);
    return DEFAULT_CREATE_VERSION;
  }, [reviewSkill, reviewInitial]);

  const dirty = Boolean(
    file ||
    name.trim() ||
    displayName.trim() ||
    tags.length ||
    tagDraft.trim() ||
    categoryId ||
    (isReviewMode ? version !== reviewDefaultVersion : version !== DEFAULT_CREATE_VERSION) ||
    changelog.trim() ||
    iconBlob ||
    createdPluginId,
  );

  function getTagDraftError() {
    const next = tagDraft.trim();
    if (!next) return null;
    if (validateSkillTag(next)) return validateSkillTag(next);
    if (tags.some((tag) => tag.trim() === next)) return t("skillMarket.form.tagDuplicate");
    if (tags.length >= MAX_SKILL_TAGS) return t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } });
    return null;
  }

  const tagSubmitError = tagError ?? validateSkillTags(tags) ?? getTagDraftError();
  // On a create there is no stored label to move forward from; in review mode the
  // plugin's live version is what the submission must exceed.
  const versionError = versionErrorKey(isReviewMode ? reviewSkill?.version : undefined, version);

  const canCreate = isReviewMode
    ? Boolean(
        version.trim() &&
        changelog.trim() &&
        // An upgrade cannot be submitted without the new package.
        (!isUpgrade || parseTaskId) &&
        !busy &&
        !saving,
      )
    : Boolean(
        parseTaskId &&
        name.trim() &&
        displayName.trim() &&
        categoryId &&
        version.trim() &&
        !versionError &&
        !busy &&
        !saving &&
        !tagSubmitError,
      );

  // 发布 asks for one thing 保存草稿 does not: a changelog, and only when the
  // plugin is headed for organization review, because that text is what the
  // reviewer reads. Gating BOTH buttons on it — as a single `canCreate` did —
  // makes 保存草稿 unreachable for exactly the authors who most need it: someone
  // who picked 本组织 and is not ready to describe the change yet.
  const canPublishNow = canCreate && (declaredVisibility === "private" || Boolean(changelog.trim()));

  function updateTagSuggestionStyle() {
    const field = tagFieldRef.current;
    if (!field) return;

    const rect = field.getBoundingClientRect();
    const gap = 6;
    const viewportPadding = 12;
    const maxPanelHeight = 180;
    const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const availableAbove = rect.top - viewportPadding - gap;
    const placeAbove = availableBelow < 120 && availableAbove > availableBelow;
    const maxHeight = Math.max(
      96,
      Math.min(maxPanelHeight, placeAbove ? availableAbove : availableBelow)
    );

    setTagSuggestionStyle({
      left: rect.left,
      top: placeAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
      width: rect.width,
      maxHeight,
    });
  }

  function handleIconClick() {
    iconInputRef.current?.click();
  }

  function handleIconInputClick(event: React.MouseEvent<HTMLInputElement>) {
    event.currentTarget.value = "";
  }

  function handleIconFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const f = event.currentTarget.files?.[0];
    if (f) setIconCropFile(f);
  }

  useEffect(() => () => { abortRef.current = true; }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  useEffect(() => {
    if (!visible || !isReviewMode || !reviewSkill) return;
    setStage("review");
    setName(reviewSkill.name);
    setDisplayName(reviewSkill.displayName || reviewSkill.name);
    setDescription(reviewSkill.description);
    setCategoryId(reviewSkill.categoryId);
    setTags(reviewSkill.tags);
    setVersion(reviewDefaultVersion);
    setChangelog(reviewInitial?.changelog ?? "");
    setIconPreview(reviewSkill.iconUrl || null);
    setIconBlob(null);
    setError(null);
    setDeclaredVisibility("space");
  }, [visible, isReviewMode, reviewSkill, reviewDefaultVersion, reviewInitial]);

  function reset() {
    abortRef.current = true;
    setStage("idle");
    setProgress(0);
    setFile(null);
    setParseTaskId(null);
    setName("");
    setDisplayName("");
    setDescription("");
    setCategoryId("");
    setTags([]);
    setTagDraft("");
    setTagSuggestions([]);
    setTagSuggestOpen(false);
    setTagSuggestionStyle({});
    setActiveTagSuggestion(0);
    setTagError(null);
    setVersion(DEFAULT_CREATE_VERSION);
    setChangelog("");
    setIconPreview(null);
    setIconBlob(null);
    setSaving(false);
    setError(null);
    setConfirmClose(null);
    setDeclaredVisibility("private");
    setCreatedPluginId(null);
    setTimeout(() => { abortRef.current = false; }, 0);
  }

  function requestClose() {
    if (busy) {
      setConfirmClose("busy");
      return;
    }
    if (dirty && !saving) {
      setConfirmClose("dirty");
      return;
    }
    onClose();
  }

  function confirmLeave() {
    reset();
    onClose();
  }

  async function startUpload(nextFile: File) {
    const validationError = validateZipFile(nextFile);
    setError(validationError);
    if (validationError) {
      setStage(isReviewMode ? "review" : "error");
      setFile(null);
      setProgress(0);
      return;
    }

    setFile(nextFile);
    setStage("uploading");
    setProgress(0);
    setError(null);
    abortRef.current = false;

    try {
      // Same three-step pipeline for both flows; only the init boundary differs.
      // A review-mode upload is a new package for an existing skill, so it goes
      // through the reupload init (which binds nothing until import/submit time).
      const { uploadId, presignedUrl, headers } =
        isReviewMode && reviewSkill
          ? await initReupload(reviewSkill.id, nextFile.name, nextFile.size)
          : await initUpload(nextFile.name, nextFile.size);
      if (abortRef.current) return;

      await uploadFile(presignedUrl, nextFile, headers, (percent) => {
        if (!abortRef.current) setProgress(percent);
      });
      if (abortRef.current) return;

      setStage("parsing");
      const { taskId } = await triggerParse(uploadId);
      if (abortRef.current) return;

      let attempts = 0;
      const maxAttempts = 60;
      while (attempts < maxAttempts) {
        if (abortRef.current) return;
        const status = await pollParse(taskId);
        if (abortRef.current) return;

        if (status.status === "success" && status.result) {
          // Review mode reuses this one pipeline rather than bolting on a second
          // uploader. The difference is what the parse result is allowed to
          // touch: an upgrade keeps the existing skill's identity and metadata
          // (the reviewer is deciding on a new version of a known skill), so
          // only the parse task and the version/changelog inputs move.
          if (isReviewMode && reviewSkill) {
            if (status.result.name !== reviewSkill.name) {
              setStage("review");
              setFile(null);
              setParseTaskId(null);
              setError(
                t("skillMarket.upload.nameMismatch", {
                  values: { expected: reviewSkill.name, actual: status.result.name },
                }),
              );
              return;
            }
            setParseTaskId(taskId);
            // Respect a version the author actually bumped in the package, but
            // never adopt one equal to what is already live — the backend
            // rejects a republished version label, so keep the suggested bump
            // and let the user override it by hand.
            if (status.result.version && status.result.version !== reviewSkill.version) {
              setVersion(status.result.version);
            }
            setStage("review");
            setError(null);
            return;
          }
          setParseTaskId(taskId);
          setName(status.result.name);
          setDescription(status.result.description);
          setTags(status.result.tags);
          setVersion(status.result.version || DEFAULT_CREATE_VERSION);
          setChangelog(t("skillMarket.form.initialChangelog"));
          setCategoryId("");
          setStage("form");
          setError(null);
          return;
        }
        if (status.status === "failed") {
          setStage(isReviewMode ? "review" : "error");
          setError(status.error?.message ?? t("skillMarket.upload.parseFailed"));
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        attempts++;
      }
      setStage(isReviewMode ? "review" : "error");
      setError(t("skillMarket.upload.parseTimeout"));
    } catch (err) {
      if (!abortRef.current) {
        setStage(isReviewMode ? "review" : "error");
        setError(err instanceof Error ? err.message : t("skillMarket.upload.uploadFailed"));
      }
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) void startUpload(nextFile);
    event.target.value = "";
  }

  function addTag() {
    const next = tagDraft.trim();
    addTagValue(next);
  }

  function addTagValue(next: string) {
    const normalized = next.trim();
    if (!normalized) {
      setTagDraft("");
      setTagSuggestOpen(false);
      return;
    }
    const validationError = validateSkillTag(normalized);
    if (validationError) {
      setTagError(validationError);
      setTagSuggestOpen(false);
      return;
    }
    if (tags.some((tag) => tag.trim() === normalized)) {
      setTagError(t("skillMarket.form.tagDuplicate"));
      setTagSuggestOpen(false);
      return;
    }
    if (tags.length >= MAX_SKILL_TAGS) {
      setTagError(t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } }));
      setTagSuggestOpen(false);
      return;
    }
    setTags([...tags, normalized].slice(0, MAX_SKILL_TAGS));
    setTagDraft("");
    setTagSuggestOpen(false);
    setActiveTagSuggestion(0);
    setTagError(null);
  }

  useEffect(() => {
    if (!visible || isReviewMode) return;
    const query = tagDraft.trim();
    if (!query || tags.length >= MAX_SKILL_TAGS || validateSkillTag(query)) {
      setTagSuggestions([]);
      setTagSuggestOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getSkillTags(query, { signal: controller.signal })
        .then((items) => {
          const next = items
            .map((item) => item.name)
            .filter((name) => name && !tags.includes(name))
            .slice(0, 8);
          setTagSuggestions(next);
          setActiveTagSuggestion(0);
          setTagSuggestOpen(next.length > 0);
        })
        .catch((err) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setTagSuggestions([]);
            setTagSuggestOpen(false);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tagDraft, tags, visible, isReviewMode]);

  useLayoutEffect(() => {
    if (!tagSuggestOpen || tagSuggestions.length === 0) return;
    updateTagSuggestionStyle();

    window.addEventListener("resize", updateTagSuggestionStyle);
    window.addEventListener("scroll", updateTagSuggestionStyle, true);
    return () => {
      window.removeEventListener("resize", updateTagSuggestionStyle);
      window.removeEventListener("scroll", updateTagSuggestionStyle, true);
    };
  }, [tagSuggestOpen, tagSuggestions.length]);

  /**
   * `publish=false` is 保存草稿 and `publish=true` is 发布. The two share every
   * validation and the create call; they differ only in whether the publish step
   * runs afterwards. A draft skips the changelog requirement, because there is
   * nothing to describe to a reviewer yet.
   */
  async function submit(publish: boolean) {
    if (isReviewMode) {
      if (!reviewSkill || !version.trim() || !changelog.trim()) {
        setError(t("skillMarket.review.versionAndChangelogRequired"));
        return;
      }
      // The content requirement for an upgrade is enforced here as well as in
      // `canCreate`: the backend rejects a contentless upgrade, and a local
      // message is clearer than surfacing that rejection.
      if (isUpgrade && !parseTaskId) {
        setError(t("skillMarket.review.packageRequired"));
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await createReviewRequest({
          pluginId: reviewSkill.id,
          version: version.trim(),
          changelog: changelog.trim(),
          // Omit entirely for a private draft — the plugin row IS the draft, so
          // there is no separate content to freeze.
          ...(parseTaskId ? { parseTaskId } : {}),
        });
        reset();
        onCreated(t("skillMarket.review.submittedToast"));
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("skillMarket.review.submitFailed"));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!displayName.trim() || !categoryId || !version.trim()) {
      setError(t("skillMarket.form.validationRequired"));
      return;
    }
    if (publish && declaredVisibility === "space" && !changelog.trim()) {
      setError(t("skillMarket.review.changelogRequired"));
      return;
    }
    if (!parseTaskId) {
      setError(t("skillMarket.form.validationNoUpload"));
      return;
    }
    if (!name.trim()) {
      setError(t("skillMarket.form.validationNoUpload"));
      return;
    }
    const draftError = getTagDraftError();
    const tagsError = validateSkillTags(tags);
    if (tagError || tagsError || draftError) {
      setTagError(tagError ?? tagsError ?? draftError);
      return;
    }
    const submittedTags = tagDraft.trim()
      ? [...tags, tagDraft.trim()].slice(0, MAX_SKILL_TAGS)
      : tags;
    setSaving(true);
    setPublishing(publish);
    setError(null);
    try {
      let iconUrl = "";
      if (iconBlob) {
        const iconUploadId = await uploadIcon(iconBlob);
        iconUrl = iconUploadId;
      }

      // ONE create, carrying the declared visibility. The old code always wrote
      // `private` and let the scope radio decide what happened next; the value
      // now survives, because it is exactly what the backend reads to route the
      // publish.
      //
      const form: NewSkillForm = {
        parseTaskId,
        name,
        displayName,
        description,
        categoryId,
        tags: submittedTags,
        visibility: declaredVisibility,
        version,
        changelog: changelog || t("skillMarket.form.initialChangelog"),
        readmeContent: createReadme(name, description, version),
        iconUrl,
        fileName: file?.name ?? "",
        fileSize: file?.size ?? 0,
      };

      // The created id is remembered across retries: if the create succeeded and
      // only the publish failed, a second press must not mint a duplicate.
      //
      // But it must not SKIP the write either. This used to return early on a
      // remembered id, so anything the author fixed after that failure — usually
      // the very thing that made it fail — was silently dropped while the toast
      // claimed the draft was saved. The retry updates the row it already
      // created instead.
      let pluginId = createdPluginId;
      if (!pluginId) {
        const created = await createSkill(form);
        pluginId = created.id;
        setCreatedPluginId(pluginId);
      } else {
        await updateSkill(pluginId, form);
      }

      if (!publish) {
        // 保存草稿: the row exists and is a draft. Nothing is listed, and the
        // author can come back to it from 我的发布.
        reset();
        onCreated(t("skillMarket.plugin.draftSavedToast"));
        onClose();
        return;
      }

      try {
        // 发布: the BACKEND decides what this means from the plugin's declared
        // visibility — list it immediately, or open an organization review. The
        // response says which happened, so the toast does not have to guess.
        const outcome = await publishPlugin({ pluginId, version, changelog });
        reset();
        onCreated(
          outcome.displayStatus === "pending_review"
            ? t("skillMarket.review.submittedToast")
            : t("skillMarket.plugin.publishedToast")
        );
        onClose();
      } catch (publishErr) {
        // The plugin was saved; say so, or the author retries and wonders why
        // there is no duplicate.
        setError(
          (publishErr instanceof Error
            ? publishErr.message
            : t("skillMarket.review.submitFailed")) +
            " " +
            t("skillMarket.review.draftSavedHint")
        );
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("skillMarket.form.createFailed"));
    } finally {
      setSaving(false);
      setPublishing(false);
    }
  }

  const modalTitle = isReviewMode
    ? reviewSkill && reviewSkill.visibility !== "private"
      ? t("skillMarket.plugin.actionUpgrade")
      : t("skillMarket.plugin.actionPublish")
    : t("skillMarket.form.createTitle");


  // Changelog is required when scope is "review"; hide the asterisk and relax
  // required styling for the private scope (changelog remains pre-filled with
  // initialChangelog so the backend gets a value, but user isn't forced to
  // edit it).
  const changelogRequired = isReviewMode || declaredVisibility === "space";

  return (
    <>
      <WKModal
        visible={visible}
        onCancel={requestClose}
        title={modalTitle}
        size="lg"
        className="skill-market-workflow-modal"
        footer={
          confirmClose ? (
            <InlineConfirmBar
              message={t(
                confirmClose === "busy"
                  ? "skillMarket.confirm.busyMessage"
                  : "skillMarket.confirm.unsavedMessage"
              )}
              actions={[
                {
                  label: t(
                    confirmClose === "busy"
                      ? "skillMarket.confirm.keepUploading"
                      : "skillMarket.confirm.keepEditing"
                  ),
                  onClick: () => setConfirmClose(null),
                },
                { label: t("skillMarket.confirm.leave"), variant: "danger", onClick: confirmLeave },
                // Only offered when there is something a draft could hold. Mid
                // upload there is no content to save, and in review/upgrade mode
                // the plugin already exists — the draft is not this form.
                ...(confirmClose === "dirty" && !isReviewMode
                  ? [
                      {
                        label: t("skillMarket.confirm.saveDraftAndLeave"),
                        variant: "primary" as const,
                        disabled: !canCreate,
                        loading: saving,
                        onClick: () => void submit(false),
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
          <>
            <WKButton variant="secondary" onClick={requestClose} disabled={saving}>{t("skillMarket.common.cancel")}</WKButton>
            {isReviewMode ? (
              <WKButton
                variant="primary"
                onClick={() => void submit(true)}
                loading={saving}
                disabled={!canCreate}
              >
                {t("skillMarket.plugin.actionUpgrade")}
              </WKButton>
            ) : (
              <>
                {/* Two actions, not a mode switch. 保存草稿 leaves the plugin
                    unlisted and skips the changelog requirement; 发布 hands the
                    routing decision to the backend, which reads the declared
                    visibility. There is no 提交审核 button any more — the author
                    should not have to know which of the two 发布 means. */}
                <WKButton
                  variant="secondary"
                  onClick={() => void submit(false)}
                  loading={saving && !publishing}
                  disabled={!canCreate || (saving && publishing)}
                >
                  {t("skillMarket.plugin.actionSaveDraft")}
                </WKButton>
                <WKButton
                  variant="primary"
                  onClick={() => void submit(true)}
                  loading={saving && publishing}
                  disabled={!canPublishNow || (saving && !publishing)}
                >
                  {t("skillMarket.plugin.actionPublish")}
                </WKButton>
              </>
            )}
          </>
          )
        }
      >
        <section className="skill-market-form skill-market-form--workflow">
          {error && (
            <div className="skill-market-form__error">
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {isReviewMode && reviewSkill && (
            <div className="skill-market-review-info">
              <span className="skill-market-card__icon" style={{ width: 32, height: 32 }}>
                {reviewSkill.iconUrl ? (
                  <img src={reviewSkill.iconUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6 }} />
                ) : (
                  <span
                    style={{
                      background: getSkillAvatarColor(reviewSkill.name),
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#fff",
                    }}
                  >
                    {getSkillAvatarText(reviewSkill.name)}
                  </span>
                )}
              </span>
              <div>
                <strong>{reviewSkill.displayName || reviewSkill.name}</strong>
                <span>
                  {/* The wording has to be honest about what a submission does.
                      For an upgrade the listed version stays live until the new
                      one is approved; for a first listing nothing is public yet. */}
                  {isUpgrade
                    ? t("skillMarket.review.upgradeSkillHint", {
                        values: { version: reviewSkill.version },
                      })
                    : t("skillMarket.review.submitSkillHint", {
                        values: { version: reviewSkill.version },
                      })}
                </span>
              </div>
            </div>
          )}

          {(!isReviewMode || isUpgrade) && (
            <div
              className={file ? "skill-market-upload-file" : "skill-market-upload-file skill-market-upload-file--empty"}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (busy) return;
                const dropped = event.dataTransfer.files?.[0];
                if (dropped) startUpload(dropped);
              }}
            >
              {file ? <FileArchive size={18} /> : <UploadCloud size={18} />}
              <div>
                <strong>
                  {file?.name ??
                    (isUpgrade
                      ? t("skillMarket.review.newPackageTitle")
                      : t("skillMarket.upload.dropzoneTitle"))}
                </strong>
                <span>
                  {file
                    ? (parseTaskId
                      ? (isUpgrade
                        ? t("skillMarket.upload.newVersionParsedWithName", { values: { name } })
                        : t("skillMarket.upload.parsedWithName", { values: { name } }))
                      : stage === "parsing"
                        ? t("skillMarket.upload.parsing")
                        : t("skillMarket.upload.uploading"))
                    : isUpgrade
                      ? t("skillMarket.review.newPackageHint")
                      : t("skillMarket.upload.parseAutofillHint")}
                </span>
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {file ? t("skillMarket.upload.reuploadShort") : t("skillMarket.upload.selectFileAction")}
              </button>
              <input
                ref={fileInputRef}
                aria-label={
                  isUpgrade
                    ? t("skillMarket.upload.selectNewFileAriaLabel")
                    : t("skillMarket.upload.selectFileAriaLabel")
                }
                className="skill-market-upload-file__input"
                type="file"
                accept={SKILL_PACKAGE_ACCEPT}
                onChange={handleFileChange}
              />
            </div>
          )}
          {stage === "uploading" && (
            <div className="skill-market-upload-status">
              <div className="skill-market-upload-status__line">
                <span>{t("skillMarket.upload.uploadProgress")}</span>
                <strong>{progress}%</strong>
              </div>
              <div className="skill-market-progress" aria-label={t("skillMarket.upload.progressBarAriaLabel")}>
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {stage === "parsing" && (
            <div className="skill-market-upload-status is-parsing">
              <Loader2 size={16} />
              <span>{t("skillMarket.upload.parsing")}</span>
            </div>
          )}

          {isReviewMode && reviewSkill && (
            <p className="skill-market-review-notice">
              {isUpgrade
                ? t("skillMarket.review.upgradeNotice", {
                    values: { version: reviewSkill.version },
                  })
                : t("skillMarket.review.firstListingNotice")}
            </p>
          )}

          {(stage === "form" || stage === "review" || isReviewMode) && (
            <div className="skill-market-form__version-section">
              <h3 className="skill-market-form__section-title">{t("skillMarket.form.versionSection")}</h3>
              <div className="skill-market-form__row">
                <label>
                  <span>{t("skillMarket.form.versionLabel")}<i className="skill-market-required">*</i></span>
                  <WKInput value={version} onChange={setVersion} placeholder={t("skillMarket.form.versionPlaceholder")} />
                  {versionError && (
                    <p className="skill-market-field-error">{t(versionError)}</p>
                  )}
                </label>
                <label>
                  <span>{t("skillMarket.form.changelogLabel")}{changelogRequired && <i className="skill-market-required">*</i>}</span>
                  <WKInput
                    value={changelog}
                    onChange={setChangelog}
                    placeholder={t("skillMarket.review.changelogPlaceholder")}
                  />
                </label>
              </div>
            </div>
          )}

          {!isReviewMode && stage === "form" && (
            <div className="skill-market-form__scope-section">
              <h3 className="skill-market-form__section-title">
                {t("skillMarket.plugin.columnVisibility")}
              </h3>
              {/* The DECLARED audience, stored as-is. It lists nothing by itself:
                  发布 is what lists it, and this value is what the backend reads
                  to decide whether that needs organization review.
                  全平台 is absent on purpose — the tenant API rejects it, it is
                  minted only through the marketplace-admin surface. */}
              <div className="skill-market-scope-options">
                <label className={declaredVisibility === "private" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="declared-visibility"
                    value="private"
                    checked={declaredVisibility === "private"}
                    onChange={() => setDeclaredVisibility("private")}
                  />
                  <div>
                    <strong>{t("skillMarket.plugin.visibilityPrivate")}</strong>
                    <span>{t("skillMarket.plugin.visibilityPrivateHint")}</span>
                  </div>
                </label>
                <label className={declaredVisibility === "space" ? "is-selected" : ""}>
                  <input
                    type="radio"
                    name="declared-visibility"
                    value="space"
                    checked={declaredVisibility === "space"}
                    onChange={() => setDeclaredVisibility("space")}
                  />
                  <div>
                    <strong>{t("skillMarket.plugin.visibilitySpace")}</strong>
                    <span>{t("skillMarket.plugin.visibilitySpaceHint")}</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {!isReviewMode && stage === "form" && (
            <>
              <h3 className="skill-market-form__section-title">{t("skillMarket.form.basicInfoSection")}</h3>

              <div className="skill-market-form__icon-row">
                <button
                  type="button"
                  className="skill-market-icon-upload"
                  title={t("skillMarket.form.uploadIcon")}
                  onClick={handleIconClick}
                  aria-label={t("skillMarket.form.uploadIcon")}
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt="icon" />
                  ) : name ? (
                    <span
                      className="skill-market-icon-upload__default"
                      style={{ background: getSkillAvatarColor(name) }}
                    >
                      {getSkillAvatarText(name)}
                    </span>
                  ) : (
                    <ImagePlus size={24} />
                  )}
                </button>
                <input
                  ref={iconInputRef}
                  className="skill-market-icon-upload__input"
                  type="file"
                  accept="image/*"
                  multiple={false}
                  onClick={handleIconInputClick}
                  onChange={handleIconFileChange}
                />
                <label>
                  <span>{t("skillMarket.form.displayName")}<i className="skill-market-required">*</i></span>
                  <WKInput value={displayName} onChange={(v: string) => setDisplayName(v.slice(0, 20))} placeholder={t("skillMarket.form.displayNamePlaceholder")} maxLength={20} />
                </label>
              </div>
              <div className="skill-market-form__row">
                <label>
                  <span>{t("skillMarket.form.category")}<i className="skill-market-required">*</i></span>
                  <select aria-label={t("skillMarket.form.category")} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">{t("skillMarket.form.categoryPlaceholder")}</option>
                    {selectableCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("skillMarket.form.tags")}</span>
                  <div className="skill-market-tag-field" ref={tagFieldRef}>
                    <div className="skill-market-tag-input">
                      {tags.map((tag) => (
                        <button key={tag} type="button" onClick={() => setTags(tags.filter((item) => item !== tag))}>
                          <span className="skill-market-tag-input__text" title={tag}>{tag}</span>
                          <XCircle size={12} />
                        </button>
                      ))}
                      <input
                        value={tagDraft}
                        onChange={(event) => {
                          const next = event.target.value;
                          setTagDraft(next);
                          setTagError(validateSkillTag(next));
                        }}
                        onFocus={() => setTagSuggestOpen(tagSuggestions.length > 0)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown" && tagSuggestions.length) {
                            event.preventDefault();
                            setTagSuggestOpen(true);
                            setActiveTagSuggestion((current) => (current + 1) % tagSuggestions.length);
                            return;
                          }
                          if (event.key === "ArrowUp" && tagSuggestions.length) {
                            event.preventDefault();
                            setTagSuggestOpen(true);
                            setActiveTagSuggestion((current) => (current - 1 + tagSuggestions.length) % tagSuggestions.length);
                            return;
                          }
                          if (event.key === "Escape") {
                            setTagSuggestOpen(false);
                            return;
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (tagSuggestOpen && tagSuggestions[activeTagSuggestion]) {
                              addTagValue(tagSuggestions[activeTagSuggestion]);
                            } else {
                              addTag();
                            }
                          }
                        }}
                        onBlur={addTag}
                        placeholder={t("skillMarket.form.tagPlaceholder")}
                        aria-label={t("skillMarket.form.tags")}
                        aria-autocomplete="list"
                        aria-expanded={tagSuggestOpen}
                        aria-describedby={(tagSubmitError || tags.length >= MAX_SKILL_TAGS) ? "skill-market-tag-hint" : undefined}
                      />
                    </div>
                    {(tagSubmitError || tags.length >= MAX_SKILL_TAGS) && (
                      <small id="skill-market-tag-hint" className={tagSubmitError ? "skill-market-tag-hint is-error" : "skill-market-tag-hint"}>
                        {tagSubmitError ?? t("skillMarket.form.tagLimit", { values: { count: MAX_SKILL_TAGS } })}
                      </small>
                    )}
                    {tagSuggestOpen && tagSuggestions.length > 0 && (
                      <div
                        className="skill-market-tag-suggestions"
                        role="listbox"
                        aria-label={t("skillMarket.form.tagSuggestions")}
                        style={tagSuggestionStyle}
                      >
                        {tagSuggestions.map((tag, index) => (
                          <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={index === activeTagSuggestion}
                            className={index === activeTagSuggestion ? "is-active" : ""}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              addTagValue(tag);
                            }}
                            onMouseEnter={() => setActiveTagSuggestion(index)}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </>
          )}
        </section>
      </WKModal>
      <IconCropModal
        visible={!!iconCropFile}
        file={iconCropFile}
        onCancel={() => setIconCropFile(null)}
        onConfirm={(blob) => {
          setIconPreview(URL.createObjectURL(blob));
          setIconBlob(blob);
          setIconCropFile(null);
        }}
      />
    </>
  );
}
