/**
 * A tiny Cache Storage for jsdom (it has none). `stubGlobal('caches', fake.caches)` and assert on `fake.urls(name)`.
 * Plain functions on purpose: `restoreMocks` would reset a `vi.fn(impl)`.
 */
export const makeCaches = (initial = {}) => {
    const stores = new Map();
    for (const [name, urls] of Object.entries(initial)) {
        stores.set(name, urls.map((url) => ({ url })));
    }
    const fake = {
        opened: [],
        deleted: [],
        failOpen: null,
        failDelete: null,
        stores,
        urls: (name) => (stores.get(name) || []).map((r) => r.url),
        caches: {
            async open(name) {
                fake.opened.push(name);
                if (fake.failOpen) throw fake.failOpen;
                if (!stores.has(name)) stores.set(name, []);
                const list = () => stores.get(name);
                return {
                    async keys() { return [...list()]; },
                    async delete(req) {
                        if (fake.failDelete) throw fake.failDelete;
                        fake.deleted.push(req.url);
                        const i = list().findIndex((r) => r.url === req.url);
                        if (i >= 0) list().splice(i, 1);
                        return i >= 0;
                    },
                    async match(req) { return list().find((r) => r.url === (req.url || req))?.response; },
                    async put(req, response) {
                        const url = req.url || req;
                        const i = list().findIndex((r) => r.url === url);
                        if (i >= 0) list()[i] = { url, response }; else list().push({ url, response });
                    },
                };
            },
        },
    };
    return fake;
};
