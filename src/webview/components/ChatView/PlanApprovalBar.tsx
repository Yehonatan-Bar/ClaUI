import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';

/** Parsed question option from AskUserQuestion tool input */
interface QuestionOption {
  label: string;
  description?: string;
}

/** Parsed question from AskUserQuestion tool input */
interface ParsedQuestion {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/** Parsed permission prompt from ExitPlanMode tool input */
interface AllowedPrompt {
  tool: string;
  prompt: string;
}

/**
 * Parse the AskUserQuestion tool input JSON to extract questions and options.
 * Returns the first question found (Claude typically asks one at a time).
 */
function parseQuestionData(planText: string): ParsedQuestion | null {
  if (!planText) return null;
  try {
    const data = JSON.parse(planText);
    const questions = data.questions;
    if (!Array.isArray(questions) || questions.length === 0) return null;
    const q = questions[0];
    return {
      question: q.question || '',
      header: q.header || '',
      options: Array.isArray(q.options) ? q.options : [],
      multiSelect: q.multiSelect === true,
    };
  } catch {
    return null;
  }
}

/**
 * Parse the ExitPlanMode tool input JSON to extract allowedPrompts.
 * These describe permissions the plan needs (e.g., Bash commands to run).
 */
function parseAllowedPrompts(planText: string): AllowedPrompt[] {
  if (!planText) return [];
  try {
    const data = JSON.parse(planText);
    if (!Array.isArray(data.allowedPrompts)) return [];
    return data.allowedPrompts.filter(
      (p: unknown): p is AllowedPrompt =>
        !!p && typeof p === 'object' &&
        typeof (p as AllowedPrompt).tool === 'string' &&
        typeof (p as AllowedPrompt).prompt === 'string'
    );
  } catch {
    return [];
  }
}

/** Max context window tokens for percentage calculation */
const MAX_CONTEXT_TOKENS = 200_000;

/**
 * Approval/question bar shown when Claude pauses for:
 * - Plan approval (ExitPlanMode) -> 4 CLI-matching options
 * - Question (AskUserQuestion) -> Option buttons + free-text input
 */
export const PlanApprovalBar: React.FC = () => {
  const { pendingApproval, setPendingApproval, cost } = useAppStore();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [hoveredOption, setHoveredOption] = useState<number | null>(null);

  const isQuestion = pendingApproval?.toolName === 'AskUserQuestion';

  const questionData = useMemo(
    () => (isQuestion && pendingApproval ? parseQuestionData(pendingApproval.planText) : null),
    [isQuestion, pendingApproval]
  );

  const allowedPrompts = useMemo(
    () => (!isQuestion && pendingApproval ? parseAllowedPrompts(pendingApproval.planText) : []),
    [isQuestion, pendingApproval]
  );

  // Calculate context usage percentage from token data
  const contextPercent = useMemo(() => {
    const tokens = cost?.inputTokens ?? 0;
    if (tokens <= 0) return 0;
    return Math.min(100, Math.round((tokens / MAX_CONTEXT_TOKENS) * 100));
  }, [cost?.inputTokens]);

  if (!pendingApproval) return null;

  const approvalToolName = pendingApproval.toolName;

  // --- Plan approval handlers (4 CLI-matching options) ---
  const handleApproveClearBypass = () => {
    postToExtension({ type: 'planApprovalResponse', action: 'approveClearBypass', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleApproveBypass = () => {
    postToExtension({ type: 'planApprovalResponse', action: 'approve', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleApproveManual = () => {
    postToExtension({ type: 'planApprovalResponse', action: 'approveManual', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) return;
    postToExtension({
      type: 'planApprovalResponse',
      action: 'feedback',
      feedback: feedbackText.trim(),
      toolName: approvalToolName,
    });
    setPendingApproval(null);
    setFeedbackText('');
    setShowFeedback(false);
  };

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendFeedback();
    }
    if (e.key === 'Escape') {
      setShowFeedback(false);
      setFeedbackText('');
    }
  };

  // --- Question answer handlers ---
  const handleOptionClick = (label: string) => {
    if (questionData?.multiSelect) {
      setSelectedOptions(prev => {
        const next = new Set(prev);
        if (next.has(label)) {
          next.delete(label);
        } else {
          next.add(label);
        }
        return next;
      });
    } else {
      postToExtension({
        type: 'planApprovalResponse',
        action: 'questionAnswer',
        selectedOptions: [label],
        toolName: approvalToolName,
      });
      setPendingApproval(null);
    }
  };

  const handleSubmitMultiSelect = () => {
    if (selectedOptions.size === 0) return;
    postToExtension({
      type: 'planApprovalResponse',
      action: 'questionAnswer',
      selectedOptions: Array.from(selectedOptions),
      toolName: approvalToolName,
    });
    setPendingApproval(null);
    setSelectedOptions(new Set());
  };

  const handleSendCustomAnswer = () => {
    if (!feedbackText.trim()) return;
    postToExtension({
      type: 'planApprovalResponse',
      action: 'questionAnswer',
      selectedOptions: [feedbackText.trim()],
      toolName: approvalToolName,
    });
    setPendingApproval(null);
    setFeedbackText('');
    setShowFeedback(false);
  };

  const handleCustomAnswerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCustomAnswer();
    }
  };

  // --- Render question UI ---
  if (isQuestion && questionData) {
    return (
      <div className="plan-approval-bar question-bar">
        <div className="question-title">
          {questionData.header && (
            <span className="question-header">{questionData.header}</span>
          )}
          {questionData.question}
        </div>
        <div className="question-options">
          {questionData.options.map((opt, i) => (
            <button
              key={i}
              className={`question-option-btn ${selectedOptions.has(opt.label) ? 'selected' : ''}`}
              onClick={() => handleOptionClick(opt.label)}
              title={opt.description || undefined}
            >
              {questionData.multiSelect && (
                <span className="question-checkbox">
                  {selectedOptions.has(opt.label) ? '[x]' : '[ ]'}
                </span>
              )}
              <span className="question-option-label">{opt.label}</span>
              {opt.description && (
                <span className="question-option-desc">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
        {questionData.multiSelect && selectedOptions.size > 0 && (
          <button className="question-submit-btn" onClick={handleSubmitMultiSelect}>
            Submit ({selectedOptions.size} selected)
          </button>
        )}
        <div className="question-custom-area">
          <button
            className="plan-feedback-btn"
            onClick={() => setShowFeedback(!showFeedback)}
          >
            {showFeedback ? 'Cancel' : 'Custom answer...'}
          </button>
          {showFeedback && (
            <div className="plan-feedback-area">
              <textarea
                className="plan-feedback-textarea"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={handleCustomAnswerKeyDown}
                placeholder="Type your answer..."
                rows={2}
                autoFocus
              />
              <button
                className="plan-feedback-send"
                onClick={handleSendCustomAnswer}
                disabled={!feedbackText.trim()}
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Plan approval option definitions (matching CLI) ---
  const planOptions = [
    {
      key: 1,
      label: `Yes, clear context${contextPercent > 0 ? ` (${contextPercent}% used)` : ''} and bypass permissions`,
      handler: handleApproveClearBypass,
    },
    {
      key: 2,
      label: 'Yes, and bypass permissions',
      handler: handleApproveBypass,
    },
    {
      key: 3,
      label: 'Yes, manually approve edits',
      handler: handleApproveManual,
    },
    {
      key: 4,
      label: 'Type here to tell Claude what to change',
      handler: () => setShowFeedback(!showFeedback),
    },
  ];

  // --- Render plan approval UI (CLI-style) ---
  return (
    <div className="plan-approval-bar">
      <div className="plan-approval-header">
        <div className="plan-approval-title">Plan Ready for Review</div>
        <div className="plan-approval-subtitle">Would you like to proceed?</div>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="plan-allowed-prompts">
          <div className="plan-allowed-prompts-label">Requested permissions:</div>
          <ul className="plan-allowed-prompts-list">
            {allowedPrompts.map((p, i) => (
              <li key={i} className="plan-allowed-prompt-item">
                <span className="plan-allowed-prompt-tool">{p.tool}</span>
                <span className="plan-allowed-prompt-desc">{p.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="plan-options-list">
        {planOptions.map((opt) => (
          <button
            key={opt.key}
            className={`plan-option-row ${hoveredOption === opt.key ? 'hovered' : ''}`}
            onClick={opt.handler}
            onMouseEnter={() => setHoveredOption(opt.key)}
            onMouseLeave={() => setHoveredOption(null)}
          >
            <span className="plan-option-indicator">
              {hoveredOption === opt.key ? '>' : ' '}
            </span>
            <span className="plan-option-number">{opt.key}.</span>
            <span className="plan-option-label">{opt.label}</span>
          </button>
        ))}
      </div>
      {showFeedback && (
        <div className="plan-feedback-area">
          <textarea
            className="plan-feedback-textarea"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            onKeyDown={handleFeedbackKeyDown}
            placeholder="Type your feedback or changes..."
            rows={3}
            autoFocus
          />
          <button
            className="plan-feedback-send"
            onClick={handleSendFeedback}
            disabled={!feedbackText.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};
