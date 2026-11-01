// Shared hierarchy surface; implementations are separated by responsibility.
export {
  HIERARCHY_LIMITS,
  HierarchyError,
  type HierarchyBasis,
  type HierarchyStep,
  type HierarchyVia,
  type HierarchyNodeDefinition,
  type HierarchyBranch,
  type HierarchyPlacementPolicy,
  type HierarchyDefinition,
  type HierarchyQuantity,
  type HierarchyEvaluation,
  type HierarchyProposalOptions,
  type HierarchyTypeScores,
  type HierarchyInstanceScores,
  type HierarchyProposal,
  type HierarchyReadOptions,
  type HierarchyPlacementNode,
  type HierarchyPage,
  type HierarchyInputNode,
  type HierarchyInput,
  validateHierarchy,
} from './hierarchy/definition.js';
export { HierarchyComputation } from './hierarchy/computation.js';
export { proposeHierarchy } from './hierarchy/proposal.js';
export { hierarchyTypeScores } from './hierarchy/scores.js';
export { HierarchyPlan, hierarchyRef } from './hierarchy/plan.js';
