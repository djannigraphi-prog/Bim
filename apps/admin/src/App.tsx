import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AdminProfile, api, getToken, Permission, setToken, setUnauthorizedHandler } from './api';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Programs } from './pages/Programs';
import { Users } from './pages/Users';
import { Audit } from './pages/Audit';
import { Admins } from './pages/Admins';
import { Catalog } from './pages/Catalog';
import { Reports } from './pages/Reports';
import { Maintenance } from './pages/Maintenance';
import { Moderation } from './pages/Moderation';
import { Merchants } from './pages/Merchants';
import { Deliveries } from './pages/Deliveries';
import { Incidents } from './pages/Incidents';
import { OnlinePayments } from './pages/OnlinePayments';
import { Payments } from './pages/Payments';
import { Couriers } from './pages/Couriers';
import { Withdrawals } from './pages/Withdrawals';

const NAV: Array<{ to: string; label: string; perm: Permission }> = [
  { to: '/reglages', label: 'Réglages', perm: 'settings.read' },
  { to: '/programmes', label: 'Programmes types', perm: 'programs.read' },
  { to: '/categories', label: 'Catégories et objectifs', perm: 'programs.read' },
  { to: '/signalements', label: 'Signalements', perm: 'reports.read' },
  { to: '/moderation', label: 'Modération', perm: 'content.read' },
  { to: '/boutiques', label: 'Boutiques', perm: 'merchants.review' },
  { to: '/livreurs', label: 'Livreurs', perm: 'couriers.review' },
  { to: '/livraisons', label: 'Tarifs de livraison', perm: 'delivery_tariffs.read' },
  { to: '/paiements', label: 'Paiements à vérifier', perm: 'payments.review' },
  { to: '/incidents', label: 'Incidents', perm: 'incidents.review' },
  { to: '/paiements-en-ligne', label: 'Paiements en ligne', perm: 'payments.online' },
  { to: '/retraits', label: 'Retraits de pièces', perm: 'coins.payouts' },
  { to: '/utilisateurs', label: 'Utilisateurs', perm: 'users.read' },
  { to: '/audit', label: "Journal d'audit", perm: 'audit.read' },
  { to: '/administrateurs', label: 'Administrateurs', perm: 'admins.manage' },
  { to: '/maintenance', label: 'Maintenance', perm: 'system.health' },
];

export function App() {
  const [me, setMe] = useState<AdminProfile | null>(null);
  const [checking, setChecking] = useState(!!getToken());

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setMe(null));
    if (!getToken()) return;
    api<AdminProfile>('/admin/v1/auth/me')
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <p className="center">Chargement…</p>;
  if (!me) return <Login onSignedIn={setMe} />;

  const can = (p: Permission) => me.permissions.includes(p);
  const first = NAV.find((n) => can(n.perm))?.to ?? '/';

  return (
    <div className="layout">
      <aside>
        <div className="brand">BIM · Administration</div>
        <nav>
          {NAV.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <strong>{me.fullName}</strong>
          <span>{me.roles.join(', ')}</span>
          <button
            className="link"
            onClick={async () => {
              await api('/admin/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
              signOut();
            }}
          >
            Se déconnecter
          </button>
        </div>
      </aside>
      <main>
        <Routes>
          {can('settings.read') && <Route path="/reglages" element={<Settings canWrite={can('settings.write')} />} />}
          {can('programs.read') && <Route path="/programmes" element={<Programs canWrite={can('programs.write')} canPublish={can('programs.publish')} />} />}
          {can('programs.read') && <Route path="/categories" element={<Catalog canWrite={can('catalog.write')} />} />}
          {can('reports.read') && <Route path="/signalements" element={<Reports canResolve={can('reports.resolve')} />} />}
          {can('content.read') && <Route path="/moderation" element={<Moderation canModerate={can('content.moderate')} />} />}
          {can('merchants.review') && <Route path="/boutiques" element={<Merchants />} />}
          {can('couriers.review') && <Route path="/livreurs" element={<Couriers />} />}
          {can('delivery_tariffs.read') && <Route path="/livraisons" element={<Deliveries canWrite={can('delivery_tariffs.write')} />} />}
          {can('payments.review') && <Route path="/paiements" element={<Payments />} />}
          {can('incidents.review') && <Route path="/incidents" element={<Incidents />} />}
          {can('coins.payouts') && <Route path="/retraits" element={<Withdrawals />} />}
          {can('payments.online') && <Route path="/paiements-en-ligne" element={<OnlinePayments />} />}
          {can('users.read') && <Route path="/utilisateurs" element={<Users canSuspend={can('users.suspend')} />} />}
          {can('audit.read') && <Route path="/audit" element={<Audit />} />}
          {can('admins.manage') && <Route path="/administrateurs" element={<Admins me={me} />} />}
          {can('system.health') && <Route path="/maintenance" element={<Maintenance />} />}
          <Route path="*" element={<Navigate to={first} replace />} />
        </Routes>
      </main>
    </div>
  );
}
