export class ModuleRegistry {
  #modules = new Map();

  register({ id, label, kind, router, status = 'not_connected', endpoints = [] }) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || !label || !kind) throw new Error('Module id, label and kind are required');
    if (this.#modules.has(id)) throw new Error(`Module ${id} is already registered`);
    this.#modules.set(id, { id, label, kind, router, status, endpoints });
    return this;
  }

  mount(app, prefix = '/api/v1') {
    for (const module of this.#modules.values()) {
      if (module.router) app.use(`${prefix}/${module.id}`, module.router);
    }
  }

  async list() {
    return Promise.all([...this.#modules.values()].map(async ({ id, label, kind, status, endpoints }) => {
      let currentStatus;
      try { currentStatus = typeof status === 'function' ? await status() : status; }
      catch { currentStatus = 'unavailable'; }
      return { id, label, kind, status: currentStatus, endpoints };
    }));
  }
}
