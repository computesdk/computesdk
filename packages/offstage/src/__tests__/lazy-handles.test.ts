import { describe, expect, it } from 'vitest';
import { LazyHandles, SANDBOX_LIFETIME_MS } from '../lazy-handles';

const KEY = 'sk_offstage_test';

/** A placeholder whose create made sandbox `id`. */
function createdIn(handles: LazyHandles<object>, placeholder: string, id: string): void {
  handles.add(KEY, placeholder, {});
  handles.created(KEY, placeholder, id);
}

describe('lazy handles', () => {
  it('holds a handle until its create succeeds, then only the real id', () => {
    const handles = new LazyHandles<object>();
    const handle = {};
    handles.add(KEY, 'lazy_a', handle);
    expect(handles.get(KEY, 'lazy_a')).toEqual({ handle });
    handles.created(KEY, 'lazy_a', 'sbx_a');
    expect(handles.get(KEY, 'lazy_a')).toMatchObject({ id: 'sbx_a' });
    expect(handles.get(KEY, 'lazy_a')).not.toHaveProperty('handle');
  });

  it('forgets a placeholder when its sandbox is destroyed through either id', () => {
    const handles = new LazyHandles<object>();
    createdIn(handles, 'lazy_a', 'sbx_a');
    createdIn(handles, 'lazy_b', 'sbx_b');
    handles.forget(KEY, 'sbx_a');
    handles.forget(KEY, 'lazy_b');
    expect(handles.get(KEY, 'lazy_a')).toBeUndefined();
    expect(handles.get(KEY, 'lazy_b')).toBeUndefined();
    expect(handles.size).toBe(0);
  });

  it('forgets created sandboxes once their lifetime is over, and keeps handles that have not created one', () => {
    let now = 0;
    const handles = new LazyHandles<object>(() => now);
    handles.add(KEY, 'lazy_unused', {});
    createdIn(handles, 'lazy_a', 'sbx_a');
    now = SANDBOX_LIFETIME_MS - 1;
    handles.add(KEY, 'lazy_b', {});
    expect(handles.size).toBe(3);

    now = SANDBOX_LIFETIME_MS;
    handles.add(KEY, 'lazy_c', {});
    expect(handles.get(KEY, 'lazy_a')).toBeUndefined();
    expect(handles.get(KEY, 'lazy_unused')).toBeDefined();
    expect(handles.size).toBe(3);
  });

  it('keys every entry by API key', () => {
    const handles = new LazyHandles<object>();
    createdIn(handles, 'lazy_a', 'sbx_a');
    expect(handles.get('sk_offstage_other', 'lazy_a')).toBeUndefined();
    handles.forget('sk_offstage_other', 'sbx_a');
    handles.forget('sk_offstage_other', 'lazy_a');
    expect(handles.get(KEY, 'lazy_a')).toMatchObject({ id: 'sbx_a' });
  });
});
