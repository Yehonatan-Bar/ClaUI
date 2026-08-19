import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { postToExtension } from '../../hooks/useClaudeStream';
import { detectRtl } from '../../hooks/useRtlDetection';

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
 * Parse the AskUserQuestion tool input JSON to extract ALL questions with their
 * options. Claude may ask up to 4 questions in a single call; every one of them
 * must be shown and answered, otherwise the CLI silently falls back to default
 * answers for the questions the user never saw.
 */
function parseQuestionData(planText: string): ParsedQuestion[] {
  if (!planText) return [];
  try {
    const data = JSON.parse(planText);
    const questions = data.questions;
    if (!Array.isArray(questions) || questions.length === 0) return [];
    return questions.map((q) => ({
      question: q?.question || '',
      header: q?.header || '',
      options: Array.isArray(q?.options) ? q.options : [],
      multiSelect: q?.multiSelect === true,
    }));
  } catch {
    return [];
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
  // Per-question answer state, keyed by question index in the tool input
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({});
  const [questionCustom, setQuestionCustom] = useState<Record<number, string>>({});
  const [questionCustomOpen, setQuestionCustomOpen] = useState<Record<number, boolean>>({});
  const [hoveredOption, setHoveredOption] = useState<number | null>(null);

  const isQuestion = pendingApproval?.toolName === 'AskUserQuestion';

  const questions = useMemo(
    () => (isQuestion && pendingApproval ? parseQuestionData(pendingApproval.planText) : []),
    [isQuestion, pendingApproval]
  );
  const isMultiQuestion = questions.length > 1;

  // A replacement approval request (bar re-shown without unmounting) must not
  // inherit answer state from the previous question set
  useEffect(() => {
    setQuestionSelections({});
    setQuestionCustom({});
    setQuestionCustomOpen({});
  }, [pendingApproval?.planText]);

  // Hebrew/Arabic anywhere in the questions or their options flips the whole bar to RTL
  const isQuestionRtl = useMemo(() => {
    if (questions.length === 0) return false;
    const parts = questions.flatMap(q => [
      q.question,
      q.header || '',
      ...q.options.flatMap(o => [o.label, o.description || '']),
    ]);
    return detectRtl(parts.join(' '));
  }, [questions]);

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
  const logApprovalUi = (event: string, payload?: Record<string, unknown>) => {
    postToExtension({
      type: 'uiDebugLog',
      source: 'PlanApprovalBar',
      event,
      payload: {
        toolName: approvalToolName,
        isQuestion,
        ...(payload || {}),
      },
      ts: Date.now(),
    });
  };

  // --- Plan approval handlers (4 CLI-matching options) ---
  const handleApproveClearBypass = () => {
    logApprovalUi('clickOption', { action: 'approveClearBypass' });
    postToExtension({ type: 'planApprovalResponse', action: 'approveClearBypass', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleApproveBypass = () => {
    logApprovalUi('clickOption', { action: 'approve' });
    postToExtension({ type: 'planApprovalResponse', action: 'approve', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleApproveManual = () => {
    logApprovalUi('clickOption', { action: 'approveManual' });
    postToExtension({ type: 'planApprovalResponse', action: 'approveManual', toolName: approvalToolName });
    setPendingApproval(null);
  };

  const handleSendFeedback = () => {
    if (!feedbackText.trim()) return;
    logApprovalUi('clickOption', { action: 'feedback', feedbackLength: feedbackText.trim().length });
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

  /** Send per-question answers to the extension and close the bar */
  const submitQuestionAnswers = (entries: { question: string; answers: string[] }[]) => {
    postToExtension({
      type: 'planApprovalResponse',
      action: 'questionAnswer',
      questionAnswers: entries,
      // Flattened labels kept for backward compatibility with older handlers
      selectedOptions: entries.flatMap(e => e.answers),
      toolName: approvalToolName,
    });
    setPendingApproval(null);
    setQuestionSelections({});
    setQuestionCustom({});
    setQuestionCustomOpen({});
  };

  const handleOptionClick = (qi: number, label: string) => {
    const q = questions[qi];
    if (!q) return;
    logApprovalUi('questionOptionClick', { questionIndex: qi, label, multiSelect: q.multiSelect });
    if (!isMultiQuestion && !q.multiSelect) {
      // Single question, single select: answer immediately (original UX)
      submitQuestionAnswers([{ question: q.question, answers: [label] }]);
      return;
    }
    // Choosing an option overrides any custom text for this question
    setQuestionCustom(prev => ({ ...prev, [qi]: '' }));
    setQuestionSelections(prev => {
      const current = prev[qi] ?? [];
      let next: string[];
      if (q.multiSelect) {
        next = current.includes(label) ? current.filter(l => l !== label) : [...current, label];
      } else {
        next = current.includes(label) ? [] : [label];
      }
      return { ...prev, [qi]: next };
    });
  };

  /** Resolved answer for one question: custom text wins over selected options */
  const answersForQuestion = (qi: number): string[] => {
    const custom = (questionCustom[qi] || '').trim();
    if (custom) return [custom];
    return questionSelections[qi] ?? [];
  };

  const answeredCount = questions.reduce(
    (count, _q, qi) => count + (answersForQuestion(qi).length > 0 ? 1 : 0),
    0
  );
  const allQuestionsAnswered = questions.length > 0 && answeredCount === questions.length;

  const handleSubmitAllAnswers = () => {
    if (!allQuestionsAnswered) return;
    logApprovalUi('questionSubmitAll', { questionCount: questions.length });
    submitQuestionAnswers(
      questions.map((q, qi) => ({ question: q.question, answers: answersForQuestion(qi) }))
    );
  };

  const handleSubmitMultiSelect = () => {
    const selected = questionSelections[0] ?? [];
    if (selected.length === 0 || !questions[0]) return;
    logApprovalUi('questionSubmitMultiSelect', { selectedCount: selected.length });
    submitQuestionAnswers([{ question: questions[0].question, answers: selected }]);
  };

  const handleSendCustomAnswer = () => {
    if (!feedbackText.trim() || !questions[0]) return;
    logApprovalUi('questionCustomAnswer', { answerLength: feedbackText.trim().length });
    submitQuestionAnswers([{ question: questions[0].question, answers: [feedbackText.trim()] }]);
    setFeedbackText('');
    setShowFeedback(false);
  };

  /** Toggle the per-question custom answer textarea (multi-question mode) */
  const handleToggleCustomOpen = (qi: number) => {
    const wasOpen = !!questionCustomOpen[qi];
    setQuestionCustomOpen(prev => ({ ...prev, [qi]: !wasOpen }));
    if (wasOpen) {
      // Closing discards the text so a hidden stale answer is never submitted
      setQuestionCustom(prev => ({ ...prev, [qi]: '' }));
    }
  };

  const handleCustomTextChange = (qi: number, value: string) => {
    setQuestionCustom(prev => ({ ...prev, [qi]: value }));
    if (value.trim()) {
      // Custom text replaces any selected options for this question
      setQuestionSelections(prev => ({ ...prev, [qi]: [] }));
    }
  };

  const handleCustomAnswerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCustomAnswer();
    }
  };

  // --- Render question UI ---
  if (isQuestion && questions.length > 0) {
    return (
      <div className="plan-approval-bar question-bar" dir={isQuestionRtl ? 'rtl' : 'ltr'}>
        {isMultiQuestion && (
          <div className="question-progress">
            {answeredCount}/{questions.length} answered
          </div>
        )}
        {questions.map((q, qi) => {
          const selected = questionSelections[qi] ?? [];
          const customText = questionCustom[qi] || '';
          return (
            <div className={isMultiQuestion ? 'question-group' : undefined} key={qi}>
              <div className="question-title">
                {q.header && (
                  <span className="question-header">{q.header}</span>
                )}
                {q.question}
              </div>
              <div className="question-options">
                {q.options.map((opt, i) => {
                  const isSelected = selected.includes(opt.label);
                  return (
                    <button
                      key={i}
                      className={`question-option-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleOptionClick(qi, opt.label)}
                      data-tooltip={opt.description || undefined}
                    >
                      {(q.multiSelect || isMultiQuestion) && (
                        <span className="question-checkbox">
                          {q.multiSelect
                            ? (isSelected ? '[x]' : '[ ]')
                            : (isSelected ? '(*)' : '( )')}
                        </span>
                      )}
                      <span className="question-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="question-option-desc">{opt.description}</span>
                      )}
                    </button>
                  );
                })}
                {isMultiQuestion && (
                  <>
                    <button
                      className={`question-option-btn question-custom-toggle ${customText.trim() ? 'selected' : ''}`}
                      onClick={() => handleToggleCustomOpen(qi)}
                      data-tooltip={questionCustomOpen[qi] ? 'Discard the custom answer' : 'Write a free-text answer for this question'}
                    >
                      <span className="question-checkbox">
                        {customText.trim() ? '(*)' : '( )'}
                      </span>
                      <span className="question-option-label">
                        {questionCustomOpen[qi] ? 'Cancel custom answer' : 'Custom answer...'}
                      </span>
                    </button>
                    {questionCustomOpen[qi] && (
                      <textarea
                        className="plan-feedback-textarea question-custom-textarea"
                        value={customText}
                        onChange={(e) => handleCustomTextChange(qi, e.target.value)}
                        placeholder="Type your answer..."
                        rows={2}
                        autoFocus
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {isMultiQuestion && (
          <button
            className="question-submit-btn"
            onClick={handleSubmitAllAnswers}
            disabled={!allQuestionsAnswered}
            data-tooltip={allQuestionsAnswered ? 'Send all your answers' : 'Answer every question to submit'}
          >
            Submit answers ({answeredCount}/{questions.length})
          </button>
        )}
        {!isMultiQuestion && questions[0].multiSelect && (questionSelections[0]?.length ?? 0) > 0 && (
          <button className="question-submit-btn" onClick={handleSubmitMultiSelect} data-tooltip="Submit your selected answers">
            Submit ({(questionSelections[0] ?? []).length} selected)
          </button>
        )}
        {!isMultiQuestion && (
          <div className="question-custom-area">
            <button
              className="plan-feedback-btn"
              onClick={() => setShowFeedback(!showFeedback)}
              data-tooltip={showFeedback ? 'Cancel the custom answer' : 'Write a free-text answer instead of choosing an option'}
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
                  data-tooltip="Send your custom answer (Enter)"
                >
                  Send
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- Plan approval option definitions (matching CLI) ---
  const planOptions = [
    {
      key: 1,
      label: `Yes, clear context${contextPercent > 0 ? ` (${contextPercent}% used)` : ''} and bypass permissions`,
      handler: handleApproveClearBypass,
      tooltip: 'Approve the plan, clear the context window, and stop asking permission for each action',
    },
    {
      key: 2,
      label: 'Yes, and bypass permissions',
      handler: handleApproveBypass,
      tooltip: 'Approve the plan and stop asking permission for each action',
    },
    {
      key: 3,
      label: 'Yes, manually approve edits',
      handler: handleApproveManual,
      tooltip: 'Approve the plan but review and confirm each edit manually',
    },
    {
      key: 4,
      label: 'Type here to tell Claude what to change',
      handler: () => setShowFeedback(!showFeedback),
      tooltip: 'Reject for now and type changes you want Claude to make',
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
            data-tooltip={opt.tooltip}
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
            data-tooltip="Send your feedback to Claude (Enter)"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
};
