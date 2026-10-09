import { useEffect, useState } from 'react';
import client from '../api/client';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

const CATEGORY_LABELS = {
  FUEL: 'Fuel',
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance / Servicing',
  INSURANCE: 'Insurance',
  PERMIT_OR_TAX: 'Permit / Tax',
  OTHER: 'Other',
};

const emptyExpenseForm = {
  category: 'REPAIR',
  description: '',
  amount: '',
  expenseDate: new Date().toISOString().slice(0, 10),
  vendorName: '',
  odometerReading: '',
  remarks: '',
};

const emptyVehicleForm = { vehicleNumber: '', model: '', capacity: '', driverName: '', driverPhone: '' };

export default function TransportExpenses() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  // null = adding a new record; a number = editing that existing one.
  const [editingVehicleId, setEditingVehicleId] = useState(null);
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [month, setMonth] = useState(currentMonth());
  const [expenses, setExpenses] = useState([]);
  const [fleetSummary, setFleetSummary] = useState(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadVehicles();
  }, []);

  useEffect(() => {
    if (selectedVehicleId) loadExpenses();
  }, [selectedVehicleId]);

  useEffect(() => {
    loadFleetSummary();
  }, [month]);

  async function loadVehicles() {
    setLoading(true);
    try {
      const { data } = await client.get('/bus/vehicles');
      setVehicles(data);
      if (data.length && !selectedVehicleId) setSelectedVehicleId(String(data[0].id));
    } finally {
      setLoading(false);
    }
  }

  async function loadExpenses() {
    const { data } = await client.get(`/bus/vehicles/${selectedVehicleId}/expenses`);
    setExpenses(data);
  }

  async function loadFleetSummary() {
    const { data } = await client.get('/bus/fleet-summary', { params: { month } });
    setFleetSummary(data);
  }

  async function handleAddVehicle(e) {
    e.preventDefault();
    setError('');
    try {
      let saved;
      if (editingVehicleId) {
        ({ data: saved } = await client.put(`/bus/vehicles/${editingVehicleId}`, vehicleForm));
      } else {
        ({ data: saved } = await client.post('/bus/vehicles', vehicleForm));
      }
      setVehicleForm(emptyVehicleForm);
      setEditingVehicleId(null);
      setShowVehicleForm(false);
      await loadVehicles();
      setSelectedVehicleId(String(saved.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this vehicle.');
    }
  }

  function openEditVehicle() {
    if (!selectedVehicle) return;
    setEditingVehicleId(selectedVehicle.id);
    setVehicleForm({
      vehicleNumber: selectedVehicle.vehicleNumber || '',
      model: selectedVehicle.model || '',
      capacity: selectedVehicle.capacity ?? '',
      driverName: selectedVehicle.driverName || '',
      driverPhone: selectedVehicle.driverPhone || '',
      active: selectedVehicle.active !== false,
    });
    setShowVehicleForm(true);
    setShowExpenseForm(false);
    setError('');
  }

  async function handleDeleteVehicle() {
    if (!selectedVehicle) return;
    if (!window.confirm(`Delete vehicle ${selectedVehicle.vehicleNumber}? This only works for a vehicle with no expenses logged and no route assigned.`)) return;
    setError('');
    try {
      await client.delete(`/bus/vehicles/${selectedVehicle.id}`);
      const { data } = await client.get('/bus/vehicles');
      setVehicles(data);
      setSelectedVehicleId(data.length ? String(data[0].id) : '');
      if (!data.length) setExpenses([]);
      loadFleetSummary();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this vehicle.');
    }
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    setError('');
    try {
      if (editingExpenseId) {
        await client.put(`/bus/expenses/${editingExpenseId}`, expenseForm);
      } else {
        await client.post('/bus/expenses', { ...expenseForm, vehicleId: selectedVehicleId });
      }
      setExpenseForm(emptyExpenseForm);
      setEditingExpenseId(null);
      setShowExpenseForm(false);
      loadExpenses();
      loadFleetSummary();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this expense.');
    }
  }

  function openEditExpense(e) {
    setEditingExpenseId(e.id);
    setExpenseForm({
      category: e.category,
      description: e.description || '',
      amount: e.amount,
      expenseDate: e.expenseDate ? String(e.expenseDate).slice(0, 10) : emptyExpenseForm.expenseDate,
      vendorName: e.vendorName || '',
      odometerReading: e.odometerReading ?? '',
      remarks: e.remarks || '',
    });
    setShowExpenseForm(true);
    setShowVehicleForm(false);
    setError('');
  }

  async function handleDeleteExpense(id) {
    if (!window.confirm('Delete this expense record? This cannot be undone.')) return;
    setError('');
    try {
      await client.delete(`/bus/expenses/${id}`);
      loadExpenses();
      loadFleetSummary();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete this expense.');
    }
  }

  function closeVehicleForm() {
    setShowVehicleForm(false);
    setEditingVehicleId(null);
    setVehicleForm(emptyVehicleForm);
  }

  function closeExpenseForm() {
    setShowExpenseForm(false);
    setEditingExpenseId(null);
    setExpenseForm(emptyExpenseForm);
  }

  const selectedVehicle = vehicles.find((v) => String(v.id) === String(selectedVehicleId));

  return (
    <div>
      <PageHeader
        eyebrow="Module 07"
        title="Transport Maintenance & Repairs"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (showVehicleForm) closeVehicleForm();
                else { setShowVehicleForm(true); closeExpenseForm(); }
              }}
              className="text-sm px-4 py-2 rounded-md border border-ink/20 hover:bg-white"
            >
              {showVehicleForm ? 'Cancel' : '+ New vehicle'}
            </button>
            <button
              onClick={() => {
                if (showExpenseForm) closeExpenseForm();
                else { setShowExpenseForm(true); closeVehicleForm(); }
              }}
              className="text-sm px-4 py-2 rounded-md bg-ink text-paper hover:bg-ink-light"
            >
              {showExpenseForm ? 'Cancel' : '+ Log expense'}
            </button>
          </div>
        }
      />

      <p className="text-sm text-slate2 -mt-4 mb-6">
        Expenses are tracked per vehicle, not per route — if a bus is reassigned to a different
        route, its maintenance history moves with it and stays intact.
      </p>

      {error && <p className="text-absent text-sm mb-4">{error}</p>}

      {/* Fleet-wide summary — always visible, independent of which vehicle is selected below */}
      {fleetSummary && (
        <div className="bg-white border border-ink/10 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg text-ink">Fleet overview</h3>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-ink/20 rounded-md px-3 py-1.5 text-sm bg-white" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
            <div>
              <p className="font-display text-2xl text-present">Rs. {fleetSummary.totals.feesCollected.toFixed(0)}</p>
              <p className="text-sm text-slate2">Total fees collected</p>
            </div>
            <div>
              <p className="font-display text-2xl text-absent">Rs. {fleetSummary.totals.totalExpenses.toFixed(0)}</p>
              <p className="text-sm text-slate2">Total expenses</p>
            </div>
            <div>
              <p className={`font-display text-2xl ${fleetSummary.totals.net >= 0 ? 'text-present' : 'text-absent'}`}>
                Rs. {fleetSummary.totals.net.toFixed(0)}
              </p>
              <p className="text-sm text-slate2">Fleet-wide net {fleetSummary.totals.net >= 0 ? '(surplus)' : '(shortfall)'}</p>
            </div>
          </div>

          <table className="register-table w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left">
                <th className="px-3 py-2">Route</th>
                <th className="px-3 py-2">Vehicle</th>
                <th className="px-3 py-2">Fees</th>
                <th className="px-3 py-2">Expenses</th>
                <th className="px-3 py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {fleetSummary.routes.length === 0 ? (
                <tr><td className="px-3 py-4 text-slate2" colSpan={5}>No routes yet.</td></tr>
              ) : (
                fleetSummary.routes.map((r) => (
                  <tr key={r.routeId} className="border-b border-ink/5 last:border-0">
                    <td className="px-3 py-2">{r.routeName}</td>
                    <td className="px-3 py-2 text-slate2 font-mono text-xs">{r.vehicleNumber || 'Unassigned'}</td>
                    <td className="px-3 py-2 text-present">Rs. {r.feesCollected.toFixed(0)}</td>
                    <td className="px-3 py-2 text-absent">Rs. {r.totalExpenses.toFixed(0)}</td>
                    <td className={`px-3 py-2 font-medium ${r.net >= 0 ? 'text-present' : 'text-absent'}`}>Rs. {r.net.toFixed(0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showVehicleForm && (
        <form onSubmit={handleAddVehicle} className="bg-white border border-ink/10 rounded-lg p-6 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-slate2 mb-1">Vehicle number</label>
            <input required value={vehicleForm.vehicleNumber} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicleNumber: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" placeholder="SCH-102" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Model</label>
            <input value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Capacity</label>
            <input type="number" value={vehicleForm.capacity} onChange={(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Driver name</label>
            <input value={vehicleForm.driverName} onChange={(e) => setVehicleForm({ ...vehicleForm, driverName: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm text-slate2 mb-1">Driver phone</label>
            <input value={vehicleForm.driverPhone} onChange={(e) => setVehicleForm({ ...vehicleForm, driverPhone: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
          </div>
          {editingVehicleId && (
            <label className="sm:col-span-3 flex items-center gap-2 text-sm text-slate2">
              <input
                type="checkbox"
                checked={vehicleForm.active !== false}
                onChange={(e) => setVehicleForm({ ...vehicleForm, active: e.target.checked })}
              />
              Vehicle is in service (untick to retire it while keeping its expense history)
            </label>
          )}
          <div className="sm:col-span-3">
            <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">
              {editingVehicleId ? 'Save changes' : 'Save vehicle'}
            </button>
          </div>
        </form>
      )}

      {!loading && vehicles.length === 0 && (
        <p className="text-slate2 text-sm">No vehicles yet. Add one to start logging expenses. Then assign it to a route from the Bus Fee Collection page.</p>
      )}

      {vehicles.length > 0 && (
        <>
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div>
              <label className="block text-sm text-slate2 mb-1">Vehicle</label>
              <select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)} className="border border-ink/20 rounded-md px-3 py-2 bg-white">
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicleNumber}{v.model ? ` — ${v.model}` : ''}{v.active === false ? ' [inactive]' : ''} {v.routes.length ? `(serving ${v.routes.map((r) => r.name).join(', ')})` : '(unassigned to a route)'}
                  </option>
                ))}
              </select>
            </div>
            {selectedVehicle && (
              <p className="text-sm text-slate2 pb-2">
                {selectedVehicle.driverName && <>Driver: {selectedVehicle.driverName} {selectedVehicle.driverPhone && `(${selectedVehicle.driverPhone})`} · </>}
                {selectedVehicle._count.expenses} expense record{selectedVehicle._count.expenses === 1 ? '' : 's'} total
              </p>
            )}
            {selectedVehicle && (
              <div className="pb-2 flex gap-3">
                <button onClick={openEditVehicle} className="text-xs text-ink hover:underline">Edit vehicle</button>
                <button onClick={handleDeleteVehicle} className="text-xs text-absent hover:underline">Delete vehicle</button>
              </div>
            )}
          </div>

          {showExpenseForm && (
            <form onSubmit={handleAddExpense} className="bg-white border border-ink/10 rounded-lg p-6 mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-slate2 mb-1">Category</label>
                <select value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2 bg-white">
                  {Object.entries(CATEGORY_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Amount</label>
                <input required type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Date</label>
                <input required type="date" value={expenseForm.expenseDate} onChange={(e) => setExpenseForm({ ...expenseForm, expenseDate: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-sm text-slate2 mb-1">Description</label>
                <input required placeholder="e.g. Replaced front brake pads" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Vendor / workshop</label>
                <input value={expenseForm.vendorName} onChange={(e) => setExpenseForm({ ...expenseForm, vendorName: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Odometer reading (km)</label>
                <input type="number" value={expenseForm.odometerReading} onChange={(e) => setExpenseForm({ ...expenseForm, odometerReading: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm text-slate2 mb-1">Remarks</label>
                <input value={expenseForm.remarks} onChange={(e) => setExpenseForm({ ...expenseForm, remarks: e.target.value })} className="w-full border border-ink/20 rounded-md px-3 py-2" />
              </div>
              <div className="sm:col-span-3">
                <button type="submit" className="text-sm px-4 py-2 rounded-md bg-present text-white hover:opacity-90">{editingExpenseId ? 'Save changes' : 'Save expense'}</button>
              </div>
            </form>
          )}

          <div className="bg-white border border-ink/10 rounded-lg overflow-hidden">
            <table className="register-table w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr><td className="px-4 py-6 text-slate2" colSpan={6}>No expenses logged for this vehicle yet.</td></tr>
                ) : (
                  expenses.map((e) => (
                    <tr key={e.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-3 text-slate2">{new Date(e.expenseDate).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-late/10 text-late">
                          {CATEGORY_LABELS[e.category] || e.category}
                        </span>
                      </td>
                      <td className="px-4 py-3">{e.description}</td>
                      <td className="px-4 py-3 text-slate2">{e.vendorName || '—'}</td>
                      <td className="px-4 py-3 font-medium">Rs. {e.amount.toFixed(0)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => openEditExpense(e)} className="text-xs text-ink hover:underline mr-3">Edit</button>
                        {isAdmin && (
                          <button onClick={() => handleDeleteExpense(e.id)} className="text-xs text-absent hover:underline">Delete</button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
