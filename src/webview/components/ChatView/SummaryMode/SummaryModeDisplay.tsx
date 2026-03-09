import React from 'react';
import { BuildingBlocks } from './animations/BuildingBlocks';
import { ProgressPath } from './animations/ProgressPath';
import { PuzzleAssembly } from './animations/PuzzleAssembly';
import { RocketLaunch } from './animations/RocketLaunch';
import { GrowingTree } from './animations/GrowingTree';
import type { AnimationProps } from './animations/shared';

interface SummaryModeDisplayProps {
  animationIndex: number;
  toolCount: number;
  isComplete: boolean;
}

const ANIMATIONS: React.FC<AnimationProps>[] = [
  BuildingBlocks,
  ProgressPath,
  PuzzleAssembly,
  RocketLaunch,
  GrowingTree,
];

export const SummaryModeDisplay: React.FC<SummaryModeDisplayProps> = ({
  animationIndex,
  toolCount,
  isComplete,
}) => {
  const AnimComponent = ANIMATIONS[animationIndex % ANIMATIONS.length];

  return (
    <div className="sm-animation-fill">
      <AnimComponent toolCount={toolCount} isComplete={isComplete} />
    </div>
  );
};
