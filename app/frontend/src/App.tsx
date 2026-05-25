import { useState } from 'react';
import { Flow } from './components/Flow';
import { Layout } from './components/Layout';
import { Screener } from './components/screener';
import { WeeklyPicksDashboard } from './components/weekly-picks';
import { RightSidebar } from './components/sidebar/right-sidebar';

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulation' | 'screener' | 'weekly-picks'>('simulation');

  return (
    <Layout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      rightSidebar={<RightSidebar />}
    >
      {activeTab === 'simulation' ? (
        <Flow />
      ) : activeTab === 'screener' ? (
        <Screener />
      ) : (
        <WeeklyPicksDashboard />
      )}
    </Layout>
  );
}
