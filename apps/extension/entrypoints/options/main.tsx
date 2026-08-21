import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Switch } from "@octo/ui";
import "@octo/ui/styles.css";
import "@octo/base/src/theme/tokens.css";
import "./style.css";
import {
  getExtensionPreferences,
  setExtensionPreferences,
} from "../../utils/extensionStorage";
import {
  DEFAULT_EXTENSION_PREFERENCES,
  type ExtensionPreferences,
} from "../../utils/extensionRuntime";

function SettingsPage() {
  const [preferences, setPreferences] = useState<ExtensionPreferences>(
    DEFAULT_EXTENSION_PREFERENCES,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    void getExtensionPreferences().then((stored) => {
      if (!mounted) {
        return;
      }

      setPreferences(stored);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const updatePreferences = async (
    updater: (current: ExtensionPreferences) => ExtensionPreferences,
  ) => {
    const next = updater(preferences);
    setPreferences(next);
    await setExtensionPreferences(next);
  };

  return (
    <main className="options-page">
      <section className="options-card">
        <div className="options-header">
          <span className="options-eyebrow">Extension Settings</span>
          <h1>Octo 配置</h1>
          <p>在这里控制扩展提醒行为。修改后会立即生效。</p>
        </div>

        <div className="options-list" aria-busy={loading}>
          <label className="options-item">
            <div className="options-copy">
              <span className="options-title">开启插件通知</span>
              <span className="options-description">
                关闭后，不再显示扩展未读角标，也不会弹出消息提醒。
              </span>
            </div>
            <Switch
              checked={preferences.notificationsEnabled}
              onChange={(checked) => {
                void updatePreferences((current) => ({
                  ...current,
                  notificationsEnabled: checked,
                }));
              }}
              disabled={loading}
            />
          </label>

          <label className="options-item">
            <div className="options-copy">
              <span className="options-title">插件通知显示系统通知</span>
              <span className="options-description">
                关闭后，保留扩展角标提醒，但不弹出浏览器系统通知。
              </span>
            </div>
            <Switch
              checked={preferences.notificationsVisible}
              onChange={(checked) => {
                void updatePreferences((current) => ({
                  ...current,
                  notificationsVisible: checked,
                }));
              }}
              disabled={loading || !preferences.notificationsEnabled}
            />
          </label>
        </div>
      </section>
    </main>
  );
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("Options root container not found.");
}

createRoot(container).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>,
);
