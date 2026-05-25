import { useState } from 'react';
import { Flow } from './components/Flow';
import { Layout } from './components/Layout';
import { Screener } from './components/screener';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulation' | 'screener'>('simulation');

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'simulation' ? <Flow /> : <Screener />}
    </Layout>
  );
}
