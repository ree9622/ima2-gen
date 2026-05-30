import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import type { WorkspaceProfile } from "../../lib/workspaceProfile";

const PROFILES: { value: WorkspaceProfile; labelKey: string; descKey: string }[] = [
  { value: "default", labelKey: "workspace.defaultLabel", descKey: "workspace.defaultDesc" },
  { value: "prompt-studio", labelKey: "workspace.promptStudioLabel", descKey: "workspace.promptStudioDesc" },
];

export function WorkspaceProfileSettings() {
  const profile = useAppStore((s) => s.workspaceProfile);
  const setProfile = useAppStore((s) => s.setWorkspaceProfile);
  const { t } = useI18n();

  return (
    <div className="settings-field">
      <select
        id="workspace-profile-select"
        className="settings-field__select"
        value={profile}
        onChange={(event) => setProfile(event.target.value as WorkspaceProfile)}
        aria-label={t("workspace.profileLabel")}
      >
        {PROFILES.map((item) => (
          <option key={item.value} value={item.value}>
            {t(item.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
