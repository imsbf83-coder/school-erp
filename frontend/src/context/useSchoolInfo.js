import { useEffect, useState } from 'react';
import client from '../api/client';
import { SCHOOL_INFO } from '../config/schoolInfo';

// The school's name, logo and principal's signature for printouts. They come
// from the Institute Data module; until that is filled in (or if it cannot be
// loaded) the fixed values in config/schoolInfo.js are used, so printouts
// never break. The data is fetched once and shared by every screen.

let cache = null;
let loading = null;
const listeners = new Set();

export function refreshInstitute() {
  loading = client
    .get('/institute/public')
    .then((r) => {
      cache = r.data;
      listeners.forEach((fn) => fn());
    })
    .catch(() => {
      // keep whatever we had: the fallback values still work
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export function useSchoolInfo() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (!cache && !loading) refreshInstitute();
    return () => listeners.delete(fn);
  }, []);

  return {
    name: cache?.name || SCHOOL_INFO.name,
    shortName: cache?.shortName || '',
    address: cache?.address || '',
    phone: cache?.phone1 || '',
    email: cache?.email || '',
    webUrl: cache?.webUrl || '',
    principalName: cache?.hoiName || '',
    logo: cache?.logoDataUrl || SCHOOL_INFO.logo,
    principalSignature: cache?.signatureDataUrl || SCHOOL_INFO.principalSignature,
  };
}
