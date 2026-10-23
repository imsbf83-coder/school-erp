import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import PageHeader from '../components/PageHeader';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Special value of the route dropdown: show riders from every route at once.
const ALL_ROUTES = 'ALL';

const emptyPassengerForm = { name: '', guardianName: '', guardianPhone: '', pickupPoint: '', note: '' };

// Must stay in step with DISCOUNT_REASONS in backend/src/routes/bus.js — the
// API validates the value with .isIn(...) and rejects anything else.
const DISCOUNT_REASONS = [
  { value: 'SIBLING', label: 'Sibling also rides' },
  { value: 'PREPAYMENT', label: 'Paid in advance' },
  { value: 'ORPHAN', label: 'Orphan' },
  { value: 'OTHER', label: 'Other' },
];

function reasonLabel(value) {
  return DISCOUNT_REASONS.find((r) => r.value === value)?.label || value;
}

// A discount can't take the fee below zero.
function netPayable(grossFee, discount) {
  return Math.max(0, Number(grossFee || 0) - Number(discount || 0));
}

export default function BusFees() {
  const [routes, setRoutes] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [riders, setRiders] = useState([]);
  const [payments, setPayments] = useState([]);
  const [dues, setDues] = useState(null);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [showPassengerForm, setShowPassengerForm] = useState(false);
  const [routeForm, setRouteForm] = useState({ name: '', monthlyFee: '', vehicleId: '' });
  const [passengerForm, setPassengerForm] = useState(emptyPassengerForm);
  const [paymentTarget, setPaymentTarget] = useState(null); // { riderType, riderId, name }
  const [paymentForm, setPaymentForm] = useState({
    grossFee: '',
    discount: '',
    discountReason: '',
    amount: '',
    paymentMethod: 'CASH',
    remarks: '',
    paymentDate: todayISO(),
  });
  // Set while an already-recorded payment is being corrected (PUT) instead of a new one (POST).
  const [editingPaymentId, setEditingPaymentId] = useState(null);
  const [editingRoute, setEditingRoute] = useState(false);
  const [routeEditForm, setRouteEditForm] = useState({ name: '', monthlyFee: '' });
  const [editingPassengerId, setEditingPassengerId] = useState(null);
  const [discountTarget, setDiscountTarget] = useState(null); // { riderType, riderId, name }
  const [discountForm, setDiscountForm] = useState({ discount: '', discountReason: 'SIBLING' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadRoutes();
    client.get('/bus/vehicles').then((res) => setVehicles(res.data));
  }, []);

  useEffect(() => {
    if (selectedRouteId) loadRouteData();
  }, [selectedRouteId, month]);

  async function loadRoutes() {
    setLoading(true);
    try {
      const { data } = await client.get('/bus/routes');
      setRoutes(data);
      if (data.length && !selectedRouteId) setSelectedRouteId(String(data[0].id));
    } finally {
      setLoading(false);
    }
  }

  async function loadRouteData() {
    if (selectedRouteId === ALL_ROUTES) {
      // Every rider on every bus, with this month's payment status, from the
      // report endpoint; reshaped to match what /bus/riders returns per route.
      const [rowsRes, paymentsRes] = await Promise.all([
        client.get('/bus/report-riders', { params: { month } }),
        client.get('/bus/payments', { params: { month } }),
      ]);
      const rows = rowsRes.data.rows;
      setRiders(
        rows.map((r) => ({
          riderType: r.riderType,
          riderId: r.riderId,
          name: r.name,
          admissionNumber: r.admissionNumber,
          classLabel: r.className,
          section: r.section,
          guardianName: r.guardianName,
          guardianPhone: r.guardianPhone,
          pickupPoint: r.pickupPoint,
          note: r.note,
          routeId: r.routeId,
          routeName: r.routeName,
          monthlyFee: r.monthlyFee,
          busFeeDiscount: r.standingDiscount,
          busFeeDiscountReason: r.standingDiscountReason,
          netPayable: r.netPayable,
        }))
      );
      setPayments(paymentsRes.data);
      const unpaid = rows.filter((r) => !r.paid);
      setDues({ dues: unpaid, totalExpected: unpaid.reduce((sum, r) => sum + (r.netPayable || 0), 0) });
      return;
    }
    const [ridersRes, paymentsRes, duesRes] = await Promise.all([
      client.get('/bus/riders', { params: { busRouteId: selectedRouteId } }),
      client.get('/bus/payments', { params: { busRouteId: selectedRouteId, month } }),
      client.get('/bus/dues', { params: { busRouteId: selectedRouteId, month } }),
    ]);
    setRiders(ridersRes.data);
    setPayments(paymentsRes.data);
    setDues(duesRes.data);
  }

  async function handleCreateRoute(e) {
    e.preventDefault();
    await client.post('/bus/routes', routeForm);
    setRouteForm({ name: '', monthlyFee: '', vehicleId: '' });
    setShowRouteForm(false);
    loadRoutes();
  }

  async function handleReassignVehicle(routeId, vehicleId) {
    await client.post(`/bus/routes/${routeId}/vehicle`, { vehicleId: vehicleId || null });
    loadRoutes();
  }

  async function handleAddPassenger(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingPassengerId) {
        await client.put(`/bus/passengers/${editingPassengerId}`, passengerForm);
      } else {
        await client.post('/bus/passengers', { ...passengerForm, busRouteId: selectedRouteId });
      }
      setPassengerForm(emptyPassengerForm);
      setEditingPassengerId(null);
      setShowPassengerForm(false);
      loadRouteData();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this passenger.');
    }
  }

  function openEditPassenger(rider) {
    setEditingPassengerId(rider.riderId);
    setPassengerForm({
      name: rider.name || '',
      guardianName: rider.guardianName || '',
      guardianPhone: rider.guardianPhone || '',
      pickupPoint: rider.pickupPoint || '',
      note: rider.note || '',
    });
    setShowPassengerForm(true);
    setError('');
  }

  async function handleRemovePassenger(rider) {
    if (!window.confirm(`Remove ${rider.name} from this route? They stop being billed; their payment history is kept.`)) return;
    setError('');
    try {
      await client.delete(`/bus/passengers/${rider.riderId}`);
      loadRouteData();
      loadRoutes();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove this passenger.');
    }
  }

  // ---- route edit / delete ----
  function openRouteEdit() {
    if (!selectedRoute) return;
    setRouteEditForm({ name: selectedRoute.name, monthlyFee: selectedRoute.monthlyFee });
    setEditingRoute(true);
    setError('');
  }

  async function handleSaveRoute(e) {
    e.preventDefault();
    setError('');
    try {
      await client.put(`/bus/routes/${selectedRoute.id}`, routeEditForm);
      setEditingRoute(false);
      loadRoutes();
      loadRouteData();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this route.');
    }
  }

  async function handleDeleteRoute() {
    if (!selectedRoute) return;
    if (!window.confirm(`Delete route "${selectedRoute.name}"? This only works for an empty route (no riders, no payments).`)) return;
    setError('');
    try {
      await client.delete(`/bus/routes/${selectedRoute.id}`);
      const { data } = await client.get('/bus/routes');
      setRoutes(data);
      setSelectedRouteId(data.length ? String(data[0].id) : '');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this route.');
    }
  }

  const selectedRoute = routes.find((r) => String(r.id) === String(selectedRouteId));

  // The rider's standing discount pre-fills this month's payment — it isn't
  // applied automatically, so the accountant can still override it for one
  // month (or add a one-off pre-payment discount) without disturbing it.
  function openPaymentForm(rider) {
    const grossFee = rider.monthlyFee ?? selectedRoute?.monthlyFee ?? '';
    const discount = rider.busFeeDiscount || '';
    setDiscountTarget(null);
    setError('');
    setEditingPaymentId(null);
    setPaymentTarget({ riderType: rider.riderType, riderId: rider.riderId, name: rider.name, admissionNumber: rider.admissionNumber, routeId: rider.routeId ?? selectedRouteId });
    setPaymentForm({
      grossFee,
      discount,
      discountReason: rider.busFeeDiscountReason || (discount ? 'SIBLING' : ''),
      amount: netPayable(grossFee, discount),
      paymentMethod: 'CASH',
      remarks: '',
      paymentDate: todayISO(),
    });
  }

  // Re-open an already-recorded payment so its amount, discount, date, method
  // or remarks can be corrected.
  function openEditPayment(rider, payment) {
    setDiscountTarget(null);
    setError('');
    setEditingPaymentId(payment.id);
    setPaymentTarget({ riderType: rider.riderType, riderId: rider.riderId, name: rider.name, admissionNumber: rider.admissionNumber, routeId: rider.routeId ?? selectedRouteId });
    setPaymentForm({
      grossFee: payment.grossFee ?? rider.monthlyFee ?? '',
      discount: payment.discount || '',
      discountReason: payment.discountReason || '',
      amount: payment.amount,
      paymentMethod: payment.paymentMethod || 'CASH',
      remarks: payment.remarks || '',
      paymentDate: payment.paymentDate ? String(payment.paymentDate).slice(0, 10) : todayISO(),
    });
  }

  async function handleDeletePayment(rider, payment) {
    if (!window.confirm(`Delete ${rider.name}'s ${month} payment of Rs. ${payment.amount}? They will show as Due again.`)) return;
    setError('');
    try {
      await client.delete(`/bus/payments/${payment.id}`);
      loadRouteData();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this payment.');
    }
  }

  // Amount follows the discount so the common case needs no arithmetic, but
  // stays editable afterwards for a partial payment.
  function changePaymentDiscount(value) {
    setPaymentForm((f) => ({ ...f, discount: value, amount: netPayable(f.grossFee, value) }));
  }

  function openDiscountForm(rider) {
    setPaymentTarget(null);
    setError('');
    setDiscountTarget({ riderType: rider.riderType, riderId: rider.riderId, name: rider.name });
    setDiscountForm({
      discount: rider.busFeeDiscount || '',
      discountReason: rider.busFeeDiscountReason || 'SIBLING',
    });
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingPaymentId) {
        await client.put(`/bus/payments/${editingPaymentId}`, {
          amount: paymentForm.amount,
          grossFee: paymentForm.grossFee,
          discount: Number(paymentForm.discount || 0),
          discountReason: paymentForm.discountReason,
          paymentMethod: paymentForm.paymentMethod,
          remarks: paymentForm.remarks,
          paymentDate: paymentForm.paymentDate,
        });
      } else {
        await client.post('/bus/payments', {
          ...paymentForm,
          riderType: paymentTarget.riderType,
          riderId: paymentTarget.riderId,
          busRouteId: paymentTarget.routeId ?? selectedRouteId,
          month,
        });
      }
      setPaymentTarget(null);
      setEditingPaymentId(null);
      loadRouteData();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this payment.');
    }
  }

  async function handleSetDiscount(e) {
    e.preventDefault();
    setError('');
    try {
      await client.post('/bus/riders/discount', {
        riderType: discountTarget.riderType,
        riderId: discountTarget.riderId,
        discount: Number(discountForm.discount || 0),
        discountReason: discountForm.discountReason,
      });
      setDiscountTarget(null);
      loadRouteData();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this discount.');
    }
  }

  // Build a quick lookup of who's paid this month, keyed by "TYPE-id"
  const paymentByKey = new Map(
    payments.map((p) => [p.studentId ? `STUDENT-${p.studentId}` : `PASSENGER-${p.busPassengerId}`, p])
  );
  const paidKeys = new Set(paymentByKey.keys());

  // Reported, not deducted: `amount` is already net of the discount, so the
  // Paid figure and this one are independent readings of the same month.
  const discountsGiven = payments.reduce((sum, p) => sum + (p.discount || 0), 0);

  // Money for the month, over the riders on screen's route(s) — not the search filter.
  // Receivable = what each rider owes after discount: for someone who has paid, the
  // fee and discount recorded on their payment; for someone who hasn't, their
  // current net payable. Balance = receivable - received, so it also picks up
  // partial payments, not just riders who haven't paid at all.
  let totalReceivable = 0;
  let totalReceived = 0;
  riders.forEach((r) => {
    const pay = paymentByKey.get(`${r.riderType}-${r.riderId}`);
    if (pay) {
      totalReceivable += netPayable(pay.grossFee ?? r.monthlyFee, pay.discount);
      totalReceived += pay.amount || 0;
    } else {
      totalReceivable += r.netPayable || 0;
    }
  });
  const balanceAmount = totalReceivable - totalReceived;

  // Search by admission number, name, class (with section) or father/guardian.
  // Every word typed must match somewhere, so "ahmed 8" finds an Ahmed in class 8.
  const searchTokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visibleRiders = searchTokens.length
    ? riders.filter((r) => {
        const hay = [r.name, r.admissionNumber, r.classLabel, r.section, r.guardianName, r.routeName].filter(Boolean).join(' ').toLowerCase();
        return searchTokens.every((t) => hay.includes(t));
      })
    : riders;

  return (
    <div>
      <PageHeader
        eyebrow="Module 06"
        title="Bus Fee Collection"
        action={
          <div className="flex gap-2">
            <Link to="/bus-reports" className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white">
              Bus reports
            </Link>
            <button onClick={() => setShowRouteForm((v) => !v)} className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light">
              {showRouteForm ? 'Cancel' : '+ New route'}
            </button>
          </div>
        }
      />

      <p className="text-sm text-slate2 -mt-4 mb-6">
        Covers both enrolled students on the bus and riders who aren't enrolled students —
        e.g. junior-section children not yet admitted, or siblings who only use the bus.
        Use "Add bus-only passenger" below for anyone not in the Students module.
      </p>

      {showRouteForm && (
        <form onSubmit={handleCreateRoute} className="bg-white border border-ink/10 rounded-lg p-6 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate2 mb-1">Route name</label>
            <input required value={routeForm.name} onChange={(e) => setRouteForm({ ...routeForm, name: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="Route 2 - North Side" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Monthly fee</label>
            <input required type="number" value={routeForm.monthlyFee} onChange={(e) => setRouteForm({ ...routeForm, monthlyFee: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Vehicle (optional — can assign later)</label>
            <select value={routeForm.vehicleId} onChange={(e) => setRouteForm({ ...routeForm, vehicleId: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
              <option value="">No vehicle yet</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicleNumber}{v.model ? ` — ${v.model}` : ''}</option>)}
            </select>
            <p className="text-xs text-slate2 mt-1">
              Manage vehicles and their maintenance history on the <a href="/transport-expenses" className="text-brass-dark hover:underline">Transport Expenses</a> page.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">Create route</button>
          </div>
        </form>
      )}

      {!loading && routes.length === 0 && (
        <p className="text-slate2 text-sm">No bus routes yet. Create one to start assigning riders and collecting fees.</p>
      )}

      {routes.length > 0 && (
        <>
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-sm text-slate2 mb-1">Route</label>
              <select value={selectedRouteId} onChange={(e) => { setSelectedRouteId(e.target.value); setSearch(''); setShowPassengerForm(false); setEditingPassengerId(null); setPassengerForm(emptyPassengerForm); }} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
                <option value={ALL_ROUTES}>
                  All routes ({routes.reduce((n, r) => n + r._count.students + r._count.passengers, 0)} riders)
                </option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r._count.students + r._count.passengers} riders)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Month</label>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white" />
            </div>
            <div>
              <label className="block text-sm text-slate2 mb-1">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Admission no., name, class"
                className="border border-ink/20 rounded-md px-3 py-2 bg-white w-60"
              />
            </div>
            {selectedRoute && (
              <div className="pb-2">
                <p className="text-sm text-slate2 mb-1">
                  Monthly fee: <span className="font-medium text-ink">Rs. {selectedRoute.monthlyFee}</span>
                  {selectedRoute.vehicle?.driverName && <> · Driver: {selectedRoute.vehicle.driverName} {selectedRoute.vehicle.driverPhone && `(${selectedRoute.vehicle.driverPhone})`}</>}
                </p>
                <label className="text-xs text-slate2 mr-2">Vehicle:</label>
                <select
                  value={selectedRoute.vehicleId || ''}
                  onChange={(e) => handleReassignVehicle(selectedRoute.id, e.target.value)}
                  className="text-xs border border-ink/20 rounded-md px-2 py-1 bg-white"
                >
                  <option value="">Unassigned</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicleNumber}</option>)}
                </select>
                <button onClick={openRouteEdit} className="text-xs text-ink hover:underline ml-3">Edit route</button>
                <button onClick={handleDeleteRoute} className="text-xs text-absent hover:underline ml-3">Delete route</button>
              </div>
            )}
            {selectedRouteId !== ALL_ROUTES && (
            <button
              onClick={() => {
                if (showPassengerForm) {
                  setEditingPassengerId(null);
                  setPassengerForm(emptyPassengerForm);
                }
                setShowPassengerForm((v) => !v);
              }}
              className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white ml-auto"
            >
              {showPassengerForm ? 'Cancel' : '+ Add bus-only passenger'}
            </button>
            )}
          </div>

          {editingRoute && (
            <form onSubmit={handleSaveRoute} className="bg-white border border-ink/10 rounded-lg p-6 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-sm text-slate2 mb-1">Route name</label>
                <input required value={routeEditForm.name} onChange={(e) => setRouteEditForm({ ...routeEditForm, name: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Monthly fee</label>
                <input required type="number" min="0" value={routeEditForm.monthlyFee} onChange={(e) => setRouteEditForm({ ...routeEditForm, monthlyFee: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">Save route</button>
                <button type="button" onClick={() => setEditingRoute(false)} className="text-sm px-4 py-2 rounded-md border border-ink/20">Cancel</button>
              </div>
              <p className="sm:col-span-3 text-xs text-slate2">
                A new fee applies to payments recorded from now on; receipts already recorded keep the fee they were taken at.
              </p>
            </form>
          )}

          {showPassengerForm && (
            <form onSubmit={handleAddPassenger} className="bg-white border border-ink/10 rounded-lg p-6 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <p className="sm:col-span-2 text-sm text-slate2 -mt-1 mb-1">
                For riders who are not in the Students module — e.g. a junior-section child too young to be admitted, or a sibling who only rides the bus.
              </p>
              <div>
                <label className="block text-sm text-slate2 mb-1">Name</label>
                <input required value={passengerForm.name} onChange={(e) => setPassengerForm({ ...passengerForm, name: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Pickup point</label>
                <input value={passengerForm.pickupPoint} onChange={(e) => setPassengerForm({ ...passengerForm, pickupPoint: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Guardian name</label>
                <input required value={passengerForm.guardianName} onChange={(e) => setPassengerForm({ ...passengerForm, guardianName: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Guardian phone</label>
                <input required value={passengerForm.guardianPhone} onChange={(e) => setPassengerForm({ ...passengerForm, guardianPhone: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm text-slate2 mb-1">Note (optional)</label>
                <input placeholder="e.g. Junior section - not yet enrolled, sibling of STU-0002" value={passengerForm.note} onChange={(e) => setPassengerForm({ ...passengerForm, note: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">{editingPassengerId ? 'Save passenger' : 'Add passenger'}</button>
              </div>
            </form>
          )}

          {dues && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className="font-display text-3xl text-present">{payments.length}</p>
                <p className="text-sm text-slate2">Paid for {month}</p>
              </div>
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className="font-display text-3xl text-absent">{dues.dues.length}</p>
                <p className="text-sm text-slate2">Dues outstanding</p>
                {dues.totalExpected > 0 && (
                  <p className="text-xs text-slate2 mt-1">Rs. {dues.totalExpected} still expected</p>
                )}
              </div>
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className="font-display text-3xl text-brass-dark">Rs. {discountsGiven}</p>
                <p className="text-sm text-slate2">Discounts given</p>
              </div>
            </div>
          )}

          {dues && (
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className="font-display text-3xl text-ink">Rs. {totalReceivable.toLocaleString()}</p>
                <p className="text-sm text-slate2">Total receivable</p>
                <p className="text-xs text-slate2 mt-1">{month}, after discounts</p>
              </div>
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className="font-display text-3xl text-present">Rs. {totalReceived.toLocaleString()}</p>
                <p className="text-sm text-slate2">Total received</p>
              </div>
              <div className="bg-white border border-ink/10 rounded-lg p-4">
                <p className={`font-display text-3xl ${balanceAmount > 0 ? 'text-absent' : 'text-present'}`}>Rs. {balanceAmount.toLocaleString()}</p>
                <p className="text-sm text-slate2">Balance amount</p>
              </div>
            </div>
          )}

          {error && !paymentTarget && !discountTarget && <p className="text-absent text-sm mb-4">{error}</p>}

          {paymentTarget && (
            <form onSubmit={handleRecordPayment} className="bg-white border border-ink/10 rounded-lg p-6 mb-6">
              <p className="text-sm text-slate2 mb-4">
                {editingPaymentId ? 'Editing' : 'Recording'} <span className="font-medium text-ink">{paymentTarget.name}</span>{paymentTarget.admissionNumber ? ` (Admn No. ${paymentTarget.admissionNumber})` : ''}'s bus fee for {month}.
              </p>
              {error && <p className="text-absent text-sm mb-4">{error}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-sm text-slate2 mb-1">Route fee</label>
                  <input
                    readOnly
                    value={paymentForm.grossFee}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-paper text-slate2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Discount</label>
                  <input
                    type="number"
                    min="0"
                    value={paymentForm.discount}
                    onChange={(e) => changePaymentDiscount(e.target.value)}
                    className="w-full border border-ink/20 rounded-md px-3 py-2"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Discount reason</label>
                  <select
                    value={paymentForm.discountReason}
                    onChange={(e) => setPaymentForm({ ...paymentForm, discountReason: e.target.value })}
                    disabled={!Number(paymentForm.discount)}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white disabled:bg-paper disabled:text-slate2"
                  >
                    <option value="">None</option>
                    {DISCOUNT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">
                    Amount received
                    <span className="text-xs"> (net Rs. {netPayable(paymentForm.grossFee, paymentForm.discount)})</span>
                  </label>
                  <input required type="number" min="0" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Method</label>
                  <select value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="ONLINE">Online</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Collection date</label>
                  <input
                    required
                    type="date"
                    value={paymentForm.paymentDate}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm text-slate2 mb-1">Remarks</label>
                  <input value={paymentForm.remarks} onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
                </div>
                <div className="flex gap-2 col-span-2 sm:col-span-1">
                  <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">{editingPaymentId ? 'Save changes' : 'Record payment'}</button>
                  <button type="button" onClick={() => { setPaymentTarget(null); setEditingPaymentId(null); }} className="text-sm px-4 py-2 rounded-md border border-ink/20">Cancel</button>
                </div>
              </div>
              <p className="text-xs text-slate2 mt-3">
                The discount here applies to {month} only. Amount received follows the net figure but stays
                editable for a partial payment.
              </p>
            </form>
          )}

          {discountTarget && (
            <form onSubmit={handleSetDiscount} className="bg-white border border-ink/10 rounded-lg p-6 mb-6">
              <p className="text-sm text-slate2 mb-4">
                Standing discount for <span className="font-medium text-ink">{discountTarget.name}</span>.
              </p>
              {error && <p className="text-absent text-sm mb-4">{error}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm text-slate2 mb-1">Discount per month</label>
                  <input
                    type="number"
                    min="0"
                    value={discountForm.discount}
                    onChange={(e) => setDiscountForm({ ...discountForm, discount: e.target.value })}
                    className="w-full border border-ink/20 rounded-md px-3 py-2"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate2 mb-1">Reason</label>
                  <select
                    value={discountForm.discountReason}
                    onChange={(e) => setDiscountForm({ ...discountForm, discountReason: e.target.value })}
                    disabled={!Number(discountForm.discount)}
                    className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white disabled:bg-paper disabled:text-slate2"
                  >
                    {DISCOUNT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">Save discount</button>
                  <button type="button" onClick={() => setDiscountTarget(null)} className="text-sm px-4 py-2 rounded-md border border-ink/20">Cancel</button>
                </div>
              </div>
              <p className="text-xs text-slate2 mt-3">
                Applies every month from now on — set 0 to remove it. It pre-fills each payment rather than
                being deducted automatically, and past receipts are untouched.
              </p>
            </form>
          )}

          <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Admn No</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Father / Guardian</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Class</th>
                  {selectedRouteId === ALL_ROUTES && <th className="px-4 py-3">Route</th>}
                  <th className="px-4 py-3">Pickup Point</th>
                  <th className="px-4 py-3">Discount</th>
                  <th className="px-4 py-3">{month} Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRiders.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate2" colSpan={selectedRouteId === ALL_ROUTES ? 10 : 9}>
                      {riders.length === 0
                        ? 'No riders yet. Assign students from the Students page, or add a bus-only passenger above.'
                        : 'No riders match your search.'}
                    </td>
                  </tr>
                ) : (
                  visibleRiders.map((r) => {
                    const key = `${r.riderType}-${r.riderId}`;
                    const paid = paidKeys.has(key);
                    return (
                      <tr key={key} className="border-b border-ink/5 last:border-0">
                        <td className="px-4 py-3 text-slate2 whitespace-nowrap">{r.admissionNumber || '—'}</td>
                        <td className="px-4 py-3">{r.name}</td>
                        <td className="px-4 py-3 text-slate2">{r.guardianName || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${r.riderType === 'STUDENT' ? 'bg-ink/10 text-ink' : 'bg-brass/10 text-brass-dark'}`}>
                            {r.riderType === 'STUDENT' ? 'Enrolled' : 'Bus only'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate2">{r.classLabel}{r.section ? ` ${r.section}` : ''}</td>
                        {selectedRouteId === ALL_ROUTES && <td className="px-4 py-3 text-slate2 whitespace-nowrap">{r.routeName}</td>}
                        <td className="px-4 py-3 text-slate2">{r.pickupPoint || '—'}</td>
                        <td className="px-4 py-3">
                          {r.busFeeDiscount > 0 ? (
                            <>
                              <span className="text-brass-dark font-medium">Rs. {r.busFeeDiscount}</span>
                              <span className="block text-xs text-slate2">
                                {r.busFeeDiscountReason ? reasonLabel(r.busFeeDiscountReason) : 'No reason recorded'}
                                {' · '}pays Rs. {r.netPayable}
                              </span>
                            </>
                          ) : (
                            <span className="text-slate2">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {paid ? (
                            <>
                              <span className="text-xs px-2 py-1 rounded-full font-medium bg-present/10 text-present">Paid</span>
                              {paymentByKey.get(key)?.paymentDate && (
                                <span className="block text-xs text-slate2 mt-1">
                                  {new Date(paymentByKey.get(key).paymentDate).toLocaleDateString()} · Rs. {paymentByKey.get(key).amount}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full font-medium bg-absent/10 text-absent">Due</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {!paid && (
                            <button onClick={() => openPaymentForm(r)} className="text-xs text-brass-dark hover:underline mr-3">
                              Record payment
                            </button>
                          )}
                          {paid && (
                            <>
                              <button onClick={() => openEditPayment(r, paymentByKey.get(key))} className="text-xs text-ink hover:underline mr-3">
                                Edit payment
                              </button>
                              <button onClick={() => handleDeletePayment(r, paymentByKey.get(key))} className="text-xs text-absent hover:underline mr-3">
                                Delete payment
                              </button>
                            </>
                          )}
                          <button onClick={() => openDiscountForm(r)} className="text-xs text-slate2 hover:underline">
                            {r.busFeeDiscount > 0 ? 'Edit discount' : 'Set discount'}
                          </button>
                          {r.riderType === 'PASSENGER' && (
                            <>
                              <button onClick={() => openEditPassenger(r)} className="text-xs text-ink hover:underline ml-3">
                                Edit
                              </button>
                              <button onClick={() => handleRemovePassenger(r)} className="text-xs text-absent hover:underline ml-3">
                                Remove
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
