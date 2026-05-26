import { type NodeTypes, type Edge, MarkerType } from '@xyflow/react';

import { AgentNode } from './components/agent-node';
import { TextInputNode } from './components/text-input-node';
import { TextOutputNode } from './components/text-output-node';
import { type AppNode } from './types';

// Types
export * from './types';

export const initialNodes: AppNode[] = [
  {
    id: 'text-input-node',
    type: 'input-node',
    position: { x: 50, y: 270 },
    data: {
      name: 'Input',
      description: 'Start Node',
      status: 'Idle',
    },
  },
  {
    id: 'aswath_damodaran',
    type: 'agent-node',
    position: { x: 300, y: 30 },
    data: {
      name: 'Aswath Damodaran',
      description: 'The Dean of Valuation',
      status: 'Idle',
    },
  },
  {
    id: 'ben_graham',
    type: 'agent-node',
    position: { x: 300, y: 110 },
    data: {
      name: 'Ben Graham',
      description: 'The Father of Value Investing',
      status: 'Idle',
    },
  },
  {
    id: 'bill_ackman',
    type: 'agent-node',
    position: { x: 300, y: 190 },
    data: {
      name: 'Bill Ackman',
      description: 'The Activist Investor',
      status: 'Idle',
    },
  },
  {
    id: 'cathie_wood',
    type: 'agent-node',
    position: { x: 300, y: 270 },
    data: {
      name: 'Cathie Wood',
      description: 'The Queen of Growth Investing',
      status: 'Idle',
    },
  },
  {
    id: 'charlie_munger',
    type: 'agent-node',
    position: { x: 300, y: 350 },
    data: {
      name: 'Charlie Munger',
      description: 'The Rational Thinker',
      status: 'Idle',
    },
  },
  {
    id: 'michael_burry',
    type: 'agent-node',
    position: { x: 300, y: 430 },
    data: {
      name: 'Michael Burry',
      description: 'The Big Short Contrarian',
      status: 'Idle',
    },
  },
  {
    id: 'peter_lynch',
    type: 'agent-node',
    position: { x: 300, y: 510 },
    data: {
      name: 'Peter Lynch',
      description: 'The 10-Bagger Investor',
      status: 'Idle',
    },
  },
  {
    id: 'phil_fisher',
    type: 'agent-node',
    position: { x: 550, y: 30 },
    data: {
      name: 'Phil Fisher',
      description: 'The Scuttlebutt Investor',
      status: 'Idle',
    },
  },
  {
    id: 'stanley_druckenmiller',
    type: 'agent-node',
    position: { x: 550, y: 110 },
    data: {
      name: 'Stanley Druckenmiller',
      description: 'The Macro Investor',
      status: 'Idle',
    },
  },
  {
    id: 'warren_buffett',
    type: 'agent-node',
    position: { x: 550, y: 190 },
    data: {
      name: 'Warren Buffett',
      description: 'The Oracle of Omaha',
      status: 'Idle',
    },
  },
  {
    id: 'technical_analyst',
    type: 'agent-node',
    position: { x: 550, y: 270 },
    data: {
      name: 'Technical Analyst',
      description: 'Chart Pattern Specialist',
      status: 'Idle',
    },
  },
  {
    id: 'fundamentals_analyst',
    type: 'agent-node',
    position: { x: 550, y: 350 },
    data: {
      name: 'Fundamentals Analyst',
      description: 'Financial Statement Specialist',
      status: 'Idle',
    },
  },
  {
    id: 'sentiment_analyst',
    type: 'agent-node',
    position: { x: 550, y: 430 },
    data: {
      name: 'Sentiment Analyst',
      description: 'Market Sentiment Specialist',
      status: 'Idle',
    },
  },
  {
    id: 'valuation_analyst',
    type: 'agent-node',
    position: { x: 550, y: 510 },
    data: {
      name: 'Valuation Analyst',
      description: 'Company Valuation Specialist',
      status: 'Idle',
    },
  },
  {
    id: 'text-output-node',
    type: 'output-node',
    position: { x: 800, y: 270 },
    data: {
      name: 'Output',
      description: 'Output Node',
      status: 'Idle',
    },
  },
];

export const initialEdges: Edge[] = [
  // Input to Analysts
  { id: 'edge-input-aswath_damodaran', source: 'text-input-node', target: 'aswath_damodaran', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-ben_graham', source: 'text-input-node', target: 'ben_graham', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-bill_ackman', source: 'text-input-node', target: 'bill_ackman', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-cathie_wood', source: 'text-input-node', target: 'cathie_wood', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-charlie_munger', source: 'text-input-node', target: 'charlie_munger', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-michael_burry', source: 'text-input-node', target: 'michael_burry', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-peter_lynch', source: 'text-input-node', target: 'peter_lynch', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-phil_fisher', source: 'text-input-node', target: 'phil_fisher', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-stanley_druckenmiller', source: 'text-input-node', target: 'stanley_druckenmiller', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-warren_buffett', source: 'text-input-node', target: 'warren_buffett', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-technical_analyst', source: 'text-input-node', target: 'technical_analyst', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-fundamentals_analyst', source: 'text-input-node', target: 'fundamentals_analyst', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-sentiment_analyst', source: 'text-input-node', target: 'sentiment_analyst', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-input-valuation_analyst', source: 'text-input-node', target: 'valuation_analyst', markerEnd: { type: MarkerType.ArrowClosed } },

  // Analysts to Output
  { id: 'edge-aswath_damodaran-output', source: 'aswath_damodaran', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-ben_graham-output', source: 'ben_graham', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-bill_ackman-output', source: 'bill_ackman', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-cathie_wood-output', source: 'cathie_wood', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-charlie_munger-output', source: 'charlie_munger', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-michael_burry-output', source: 'michael_burry', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-peter_lynch-output', source: 'peter_lynch', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-phil_fisher-output', source: 'phil_fisher', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-stanley_druckenmiller-output', source: 'stanley_druckenmiller', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-warren_buffett-output', source: 'warren_buffett', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-technical_analyst-output', source: 'technical_analyst', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-fundamentals_analyst-output', source: 'fundamentals_analyst', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-sentiment_analyst-output', source: 'sentiment_analyst', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'edge-valuation_analyst-output', source: 'valuation_analyst', target: 'text-output-node', markerEnd: { type: MarkerType.ArrowClosed } },
];

export const nodeTypes = {
  'agent-node': AgentNode,
  'input-node': TextInputNode,
  'output-node': TextOutputNode,
} satisfies NodeTypes;
