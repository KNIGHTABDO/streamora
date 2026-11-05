// Always safe to call, including browsers without User Timing detail support.
export const mark = (name, detail) => { try { performance.mark(name, detail ? { detail } : undefined); } catch {} };
