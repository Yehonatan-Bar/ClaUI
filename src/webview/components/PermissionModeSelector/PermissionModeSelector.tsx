import React, { useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/** Available permission modes with display labels */
const PERMISSION_OPTIONS = [
  { label: 'Full Access', value: 'full-access' as const },
  { label: 'Supervised', value: 'supervised' as const },
];

/**
 * Permission mode selector dropdown.
 * "Full Access" = all tools auto-approved (current default with -p).
 * "Supervised" = only read-only tools allowed; write tools are denied.
 * Changes take effect on the next session start.
 */
export const PermissionModeSelector: React.FC = () => {
  const { permissionMode, isConnected, setPermissionMode } = useAppStore();

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMode = e.target.value as 'full-access' | 'supervised';
    setPermissionMode(newMode);
    postToExtension({ type: 'setPermissionMode', mode: newMode });
  }, [setPermissionMode]);

  const activeLabel = PERMISSION_OPTIONS.find(o => o.value === permissionMode)?.label || permissionMode;

  return (
    <div className="permission-mode-selector">
      <span className="permission-mode-label">Permissions</span>
      <select
        className="permission-mode-select"
        value={permissionMode}
        onChange={handleChange}
        title={isConnected
          ? `Active: ${activeLabel} (change takes effect on next session)`
          : 'Select permission mode for next session'}
      >
        {PERMISSION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
