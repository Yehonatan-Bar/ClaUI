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

/**
 * Approval/question bar shown when Claude pauses for:
 * - Plan approval (ExitPlanMode) -> Approve/Reject/Feedback buttons
 * - Question (AskUserQuestion) -> Option buttons + free-text input
 */
export const PlanApprovalBar: React.FC = () => {
  const { pendingApproval, setPendingApproval } = useAppStore();
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());

  const isQuestion = pendingApproval?.toolName === 'AskUserQuestion';

  const questionData = useMemo(
    () => (isQuestion && pendingApproval ? parseQuestionData(pendingApproval.planText) : null),
    [isQuestion, pendingApproval]
  );

  const allowedPrompts = useMemo(
    () => (!isQuestion && pendingApproval ? parseAllowedPrompts(pendingApproval.planText) : []),
    [isQuestion, pendingApproval]
  );

  if (!pendingApproval) return null;

  // --- Plan approval handlers ---
  const handleApprove = () => {
    postToExtension({ type: 'planApprovalResponse', action: 'approve' });
    setPendingApproval(null);
  };

  const handleReject = () => {
    postToExtension({ type: 'planApprovalResponse', action: 'reject' });
    setPendingApproval(null);
  };

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) return;
    postToExtension({
      type: 'planApprovalResponse',
      action: 'feedback',
      feedback: feedbackText.trim(),
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
      // Single select: send immediately
      postToExtension({
        type: 'planApprovalResponse',
        action: 'questionAnswer',
        selectedOptions: [label],
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

  // --- Render plan approval UI ---
  return (
    <div className="plan-approval-bar">
      <div className="plan-approval-title">Plan Ready for Review</div>
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
      <div className="plan-approval-buttons">
        <button className="plan-approve-btn" onClick={handleApprove}>
          Approve
        </button>
        <button className="plan-reject-btn" onClick={handleReject}>
          Reject
        </button>
        <button
          className="plan-feedback-btn"
          onClick={() => setShowFeedback(!showFeedback)}
        >
          {showFeedback ? 'Cancel' : 'Give Feedback'}
        </button>
      </div>
      {showFeedback && (
        <div className="plan-feedback-area">
          <textarea
            className="plan-feedback-textarea"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            onKeyDown={handleFeedbackKeyDown}
            placeholder="Type your feedback..."
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
