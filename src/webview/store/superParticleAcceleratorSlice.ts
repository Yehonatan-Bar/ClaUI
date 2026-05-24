import type {
  SuperParticleAcceleratorStatus,
  SuperParticleAcceleratorAuditEvent,
} from '../../shared/super-particle-accelerator/types';

export interface SuperParticleAcceleratorUiState {
  superParticleAcceleratorEnabled: boolean;
  superParticleAcceleratorMode: 'block' | 'audit';
  superParticleAcceleratorStatus: SuperParticleAcceleratorStatus;
  superParticleAcceleratorAuditEvents: SuperParticleAcceleratorAuditEvent[];
  superParticleAcceleratorLastEvent?: SuperParticleAcceleratorAuditEvent;
  superParticleAcceleratorError?: string;
  superParticleAcceleratorPanelOpen: boolean;

  setSuperParticleAcceleratorPanelOpen: (open: boolean) => void;
  setSuperParticleAcceleratorStatus: (status: SuperParticleAcceleratorStatus, enabled: boolean, mode: 'block' | 'audit') => void;
  setSuperParticleAcceleratorAuditEvents: (events: SuperParticleAcceleratorAuditEvent[]) => void;
  setSuperParticleAcceleratorLastEvent: (event: SuperParticleAcceleratorAuditEvent) => void;
  setSuperParticleAcceleratorError: (error: string | undefined) => void;
}

export const superParticleAcceleratorSliceDefaults = {
  superParticleAcceleratorEnabled: false,
  superParticleAcceleratorMode: 'block' as const,
  superParticleAcceleratorStatus: 'disabled' as SuperParticleAcceleratorStatus,
  superParticleAcceleratorAuditEvents: [] as SuperParticleAcceleratorAuditEvent[],
  superParticleAcceleratorLastEvent: undefined as SuperParticleAcceleratorAuditEvent | undefined,
  superParticleAcceleratorError: undefined as string | undefined,
  superParticleAcceleratorPanelOpen: false,
};
