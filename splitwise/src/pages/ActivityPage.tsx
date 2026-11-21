import { Link } from 'react-router-dom';
import { EmptyState, PageHeader } from '../components/PageHeader';
import { timeAgo } from '../lib/date';
import { useApp } from '../store/AppStore';

export function ActivityPage() {
  const { data } = useApp();
  return (
    <>
      <PageHeader title="Recent activity" />
      {data.activity.length === 0 ? (
        <EmptyState icon="🔔" title="Nothing yet"><p className="muted">Changes you make will be listed here.</p></EmptyState>
      ) : (
        <ul className="activity-list">
          {data.activity.map((a) => {
            const group = a.groupId ? data.groups.find((g) => g.id === a.groupId) : undefined;
            return (
              <li key={a.id}>
                <p>{a.message}</p>
                <small className="muted">
                  {timeAgo(a.at)}
                  {group && (
                    <>
                      {' '}· <Link to={`/groups/${group.id}`}>{group.name}</Link>
                    </>
                  )}
                </small>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
