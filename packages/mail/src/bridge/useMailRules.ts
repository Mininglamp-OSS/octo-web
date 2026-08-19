import { useCallback, useEffect, useState } from "react";
import MailService from "../Service/MailService";
import { getErrorMessage } from "../utils";
import type { MailRule, MailRuleInput } from "./types";

export default function useMailRules(mailboxId: string, fallbackError: string) {
  const [rules, setRules] = useState<MailRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void MailService.listMailRules(mailboxId)
      .then((nextRules) => {
        if (!active) return;
        setRules(nextRules);
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason, fallbackError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fallbackError, mailboxId, revision]);

  const save = useCallback(
    async (input: MailRuleInput, ruleId?: string) => {
      if (saving) return false;
      setSaving(true);
      setActionError("");
      try {
        const saved = ruleId
          ? await MailService.updateMailRule(mailboxId, ruleId, input)
          : await MailService.createMailRule(mailboxId, input);
        setRules((current) => {
          const exists = current.some((rule) => rule.id === saved.id);
          const next = exists
            ? current.map((rule) => (rule.id === saved.id ? saved : rule))
            : [...current, saved];
          return next.sort(
            (left, right) =>
              right.priority - left.priority || left.id.localeCompare(right.id)
          );
        });
        return true;
      } catch (reason) {
        setActionError(getErrorMessage(reason, fallbackError));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [fallbackError, mailboxId, saving]
  );

  const setEnabled = useCallback(
    async (rule: MailRule, enabled: boolean) => {
      setActionError("");
      try {
        const updated = await MailService.updateMailRule(mailboxId, rule.id, {
          enabled,
        });
        setRules((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        );
      } catch (reason) {
        setActionError(getErrorMessage(reason, fallbackError));
      }
    },
    [fallbackError, mailboxId]
  );

  const remove = useCallback(
    async (rule: MailRule) => {
      if (deletingId) return false;
      setDeletingId(rule.id);
      setActionError("");
      try {
        await MailService.deleteMailRule(mailboxId, rule.id);
        setRules((current) => current.filter((item) => item.id !== rule.id));
        return true;
      } catch (reason) {
        setActionError(getErrorMessage(reason, fallbackError));
        return false;
      } finally {
        setDeletingId("");
      }
    },
    [deletingId, fallbackError, mailboxId]
  );

  return {
    rules,
    loading,
    error,
    actionError,
    saving,
    deletingId,
    reload,
    save,
    setEnabled,
    remove,
  };
}
