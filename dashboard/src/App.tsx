import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { NODES } from './config';
import { useMetrics } from './useMetrics';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

const NODE_COLORS: Record<string, string> = {
  us: '#6d8bff',
  eu: '#22c55e',
  asia: '#f59e0b',
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number): string {
  return `${n.toFixed(1)} ms`;
}

export default function App() {
  const { edgeMetrics, edgeReachable, routing, originPurges, history, lastUpdated } = useMetrics();

  const totalHits = NODES.reduce((sum, n) => sum + (edgeMetrics[n.id]?.hits || 0), 0);
  const totalMisses = NODES.reduce((sum, n) => sum + (edgeMetrics[n.id]?.misses || 0), 0);
  const aggregateHitRatio = totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0;

  const requestsPerNodeData = {
    labels: NODES.map((n) => n.label),
    datasets: [
      {
        label: 'Requests routed',
        data: NODES.map((n) => routing?.requestsPerNode?.[n.id] ?? 0),
        backgroundColor: NODES.map((n) => NODE_COLORS[n.id]),
        borderRadius: 6,
      },
    ],
  };

  const hitRatioHistoryData = {
    labels: history.map((h) => new Date(h.t).toLocaleTimeString()),
    datasets: NODES.map((n) => ({
      label: n.label,
      data: history.map((h) => (h.hitRatioByNode[n.id] ?? 0) * 100),
      borderColor: NODE_COLORS[n.id],
      backgroundColor: NODE_COLORS[n.id],
      tension: 0.3,
      pointRadius: 0,
    })),
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#e6e8ee' } } },
    scales: {
      x: { ticks: { color: '#8b93a7' }, grid: { color: '#232c42' } },
      y: { ticks: { color: '#8b93a7' }, grid: { color: '#232c42' } },
    },
  };

  return (
    <div className="app">
      <div className="app-header">
        <div>
          <h1>MiniCDN Dashboard</h1>
          <div className="subtitle">
            Geo-aware routing · cache invalidation · edge caching — live metrics
          </div>
        </div>
        <div className="subtitle">
          {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'Connecting…'}
        </div>
      </div>

      <div className="grid">
        <div className="panel">
          <h2>Aggregate hit ratio</h2>
          <div className="big-stat">
            {pct(aggregateHitRatio)}
            <span className="unit">
              ({totalHits} hits / {totalMisses} misses)
            </span>
          </div>
        </div>
        <div className="panel">
          <h2>Requests routed</h2>
          <div className="big-stat">{routing?.requestsRouted ?? 0}</div>
        </div>
        <div className="panel">
          <h2>Purges issued</h2>
          <div className="big-stat">{originPurges ?? '—'}</div>
        </div>
      </div>

      <div className="grid">
        {NODES.map((node) => {
          const m = edgeMetrics[node.id];
          const reachable = edgeReachable[node.id];
          const healthy = routing?.nodeHealth?.[node.id]?.healthy ?? reachable;
          return (
            <div className="panel node-card" key={node.id}>
              <div className="node-title">
                <span className={`status-dot ${healthy ? 'healthy' : 'unhealthy'}`} />
                {node.label}
                <span className="badge">{node.id}</span>
              </div>
              {!reachable && <div className="offline">Node unreachable</div>}
              {m && (
                <>
                  <div className="metric-row">
                    <span>Hit ratio</span>
                    <strong>{pct(m.hitRatio)}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Requests</span>
                    <strong>{m.totalRequests}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Avg hit latency</span>
                    <strong>{ms(m.avgHitLatencyMs)}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Avg miss latency</span>
                    <strong>{ms(m.avgMissLatencyMs)}</strong>
                  </div>
                  <div className="metric-row">
                    <span>Cache entries</span>
                    <strong>
                      {m.cacheEntryCount} / {m.cacheMaxEntries}
                    </strong>
                  </div>
                  <div className="metric-row">
                    <span>Last invalidation</span>
                    <strong>
                      {m.lastInvalidation ? `${m.lastInvalidation.key} (${m.lastInvalidation.propagationMs}ms)` : '—'}
                    </strong>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="two-col">
        <div className="panel">
          <h2>Hit ratio over time</h2>
          <div className="chart-wrap">
            <Line data={hitRatioHistoryData} options={chartOptions} />
          </div>
        </div>
        <div className="panel">
          <h2>Requests per node</h2>
          <div className="chart-wrap">
            <Bar data={requestsPerNodeData} options={chartOptions} />
          </div>
        </div>
      </div>

      <div className="footer-note">
        Polling each edge node's <code>/metrics</code>, the routing layer's <code>/metrics</code>, and the
        origin's <code>/admin/stats</code> every 3s directly from the browser. Run load-tests/hit-ratio.js
        or curl the routing layer with different <code>?loc=</code> values to see this move.
      </div>
    </div>
  );
}
