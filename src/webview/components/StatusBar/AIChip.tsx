import React, { useRef, useCallback } from 'react';
import { useAppStore } from '../../state/store';
import { ModelSelector } from '../ModelSelector/ModelSelector';
import { CodexModelSelector } from '../ModelSelector/CodexModelSelector';
import { CodexReasoningEffortSelector } from '../ModelSelector/CodexReasoningEffortSelector';
import { PermissionModeSelector } from '../PermissionModeSelector/PermissionModeSelector';
import type { ProviderId } from '../../../extension/types/webview-messages';
import { postToExtension } from '../../hooks/useClaudeStream';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { getClaudeModelCompactLabel, getClaudeModelLabel } from '../../utils/claudeModelDisplay';

interface AIChipProps {
  isOpen: boolean;
  onToggle: () => void;
  /** 'compact' hides permissions inline, 'minimal' shows only provider name */
  displayMode?: 'full' | 'compact' | 'minimal';
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  remote: 'Happy',
};

const HANDOFF_PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  remote: 'Happy',
};

const PROVIDER_COLORS: Record<ProviderId, string> = {
  claude: 'var(--vscode-button-background, #0e639c)',
  codex: '#238636',
  remote: '#8957e5',
};

export const AIChip: React.FC<AIChipProps> = ({ isOpen, onToggle, displayMode = 'full' }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    provider,
    selectedProvider,
    providerCapabilities,
    setSelectedProvider,
    isBusy,
    isConnected,
    model,
    handoffStage,
  } = useAppStore();

  const handleClose = useCallback(() => {
    if (isOpen) onToggle();
  }, [isOpen, onToggle]);

  useOutsideClick('ai-chip', wrapperRef, isOpen, handleClose);

  const isHandoffRunning =
    handoffStage !== 'idle' &&
    handoffStage !== 'completed' &&
    handoffStage !== 'failed';

  const isCodexUi = provider === 'codex' || !providerCapabilities.supportsPermissionModeSelector;
  const modelSelectorElement = isCodexUi ? <CodexModelSelector /> : <ModelSelector />;
  const codexReasoningSelectorElement = isCodexUi ? <CodexReasoningEffortSelector /> : null;
  const permissionSelectorElement = providerCapabilities.supportsPermissionModeSelector
    ? <PermissionModeSelector />
    : null;

  const currentProvider = provider ?? selectedProvider ?? 'claude';
  const providerColor = PROVIDER_COLORS[currentProvider] || PROVIDER_COLORS.claude;

  // Shorten model name for compact display
  const modelDisplayName = getClaudeModelLabel(model);
  const shortModelName = getClaudeModelCompactLabel(model);

  const handleOpenProviderTab = (targetProvider: ProviderId) => {
    if (provider === targetProvider || isBusy || isHandoffRunning) return;
    if (selectedProvider !== targetProvider) {
      setSelectedProvider(targetProvider);
    }
    postToExtension({ type: 'openProviderTab', provider: targetProvider });
  };

  // Carry context
  const fallbackTarget: ProviderId = provider === 'claude' ? 'codex' : 'claude';
  const carryTarget: ProviderId = selectedProvider === provider ? fallbackTarget : selectedProvider;
  const canCarryContext =
    !!isConnected &&
    !isBusy &&
    !isHandoffRunning &&
    (provider === 'claude' || provider === 'codex') &&
    (carryTarget === 'claude' || carryTarget === 'codex') &&
    carryTarget !== provider;

  const handleCarryContext = () => {
    if (!canCarryContext) return;
    postToExtension({
      type: 'switchProviderWithContext',
      targetProvider: carryTarget,
      keepSourceOpen: true,
    });
  };

  // Permission label for inline display
  const permStore = useAppStore.getState();
  const permLabel = (permStore as any).permissionMode === 'plan'
    ? 'Plan'
    : (permStore as any).permissionMode === 'acceptEdits'
      ? 'Edit'
      : 'Full';

  return (
    <div className="ai-chip-wrapper" ref={wrapperRef}>
      <button
        className={`ai-chip ${isOpen ? 'open' : ''}`}
        onClick={onToggle}
        data-tooltip="AI configuration"
      >
        <span
          className="ai-chip-provider"
          style={{ background: providerColor }}
        >
          {PROVIDER_LABELS[currentProvider] || 'Claude'}
        </span>
        {displayMode !== 'minimal' && (
          <span className="ai-chip-model">
            {displayMode === 'compact' ? shortModelName : modelDisplayName}
          </span>
        )}
        {displayMode === 'full' && permissionSelectorElement && (
          <span className="ai-chip-perm">{permLabel}</span>
        )}
        <span className="ai-chip-arrow">{isOpen ? '\u25BC' : '\u25B2'}</span>
      </button>

      {isOpen && (
        <div className="ai-chip-dropdown">
          <div className="ai-chip-dropdown-section-label">Provider</div>
          <div className="ai-chip-provider-row">
            {(['claude', 'codex', 'remote'] as ProviderId[]).map((p) => (
              <button
                key={p}
                className={`ai-chip-provider-pill ${currentProvider === p ? 'active' : ''}`}
                onClick={() => handleOpenProviderTab(p)}
                disabled={isBusy || isHandoffRunning || provider === p}
                style={currentProvider === p ? { background: PROVIDER_COLORS[p] } : undefined}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="ai-chip-dropdown-sep" />
          <div className="ai-chip-dropdown-control">
            {modelSelectorElement}
          </div>
          {codexReasoningSelectorElement && (
            <div className="ai-chip-dropdown-control">
              {codexReasoningSelectorElement}
            </div>
          )}
          {permissionSelectorElement && (
            <div className="ai-chip-dropdown-control">
              {permissionSelectorElement}
            </div>
          )}
          {canCarryContext && (
            <>
              <div className="ai-chip-dropdown-sep" />
              <button
                className="ai-chip-dropdown-item carry-btn"
                onClick={handleCarryContext}
                data-tooltip={`Switch current tab to ${HANDOFF_PROVIDER_LABELS[carryTarget]} and carry context`}
              >
                Carry to {HANDOFF_PROVIDER_LABELS[carryTarget]}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
