import React from 'react';
import type { NestedAgentInfo } from './AgentSpawnBlock';

/** CSS class suffix by agent type */
const AGENT_TYPE_CLASS: Record<string, string> = {
  Explore: 'agent-explore',
  Plan: 'agent-plan',
  'general-purpose': 'agent-general',
};

interface AgentHierarchyBlockProps {
  children: NestedAgentInfo[];
}

/**
 * Renders a tree visualization of nested sub-agents spawned by a parent agent.
 * Vertical connector line with horizontal branches to each child agent card.
 */
export const AgentHierarchyBlock: React.FC<AgentHierarchyBlockProps> = ({ children }) => {
  if (children.length === 0) return null;

  return (
    <div className="agent-hierarchy">
      <div className="agent-section-label">Sub-agents</div>
      <div className="agent-hierarchy-tree">
        {children.map((child, index) => {
          const typeClass = AGENT_TYPE_CLASS[child.subagentType] || 'agent-general';
          return (
            <div key={`${child.description}-${index}`} className="agent-hierarchy-branch">
              <div className="agent-hierarchy-connector" />
              <div className={`agent-hierarchy-card ${typeClass}`}>
                <span className={`agent-status-dot ${child.status}`} />
                <span className={`agent-type-badge ${typeClass}`}>{child.subagentType}</span>
                <span className="agent-description">{child.description}</span>
                {child.status === 'completed' && (
                  <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 'auto' }}>done</span>
                )}
                {child.status === 'error' && (
                  <span style={{ color: '#f44336', fontSize: 10, marginLeft: 'auto' }}>error</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
