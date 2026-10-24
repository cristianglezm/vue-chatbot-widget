import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { isProxy } from 'vue';
import { useVectorStore } from '../src/stores/vectorStore';

const vec = (...n) => new Float32Array(n);

describe('vectorStore', () => {
    let store;
    beforeEach(() => {
        setActivePinia(createPinia());
        store = useVectorStore();
    });

    describe('documents', () => {
        it('starts empty', () => {
            expect(store.getDocumentLength).toBe(0);
            expect(store.documentsKeys()).toEqual([]);
        });

        it('adds, finds and reads a document by title', () => {
            store.addDocument('t1', 'content 1');
            expect(store.hasDocument('t1')).toBe(true);
            expect(store.hasDocument('nope')).toBe(false);
            expect(store.getDocument('t1')).toBe('content 1');
            expect(store.getDocument('nope')).toBeUndefined();
            expect(store.getDocumentLength).toBe(1);
        });

        it('adding the same title again replaces the content', () => {
            store.addDocument('t1', 'old');
            store.addDocument('t1', 'new');
            expect(store.getDocument('t1')).toBe('new');
            expect(store.getDocumentLength).toBe(1);
        });

        it('maps an array of { title, content }', () => {
            store.mapDocuments([{ title: 'a', content: 'A' }, { title: 'b', content: 'B' }]);
            expect(store.documentsKeys()).toEqual(['a', 'b']);
            expect(store.getDocument('b')).toBe('B');
        });

        it('removes a document', () => {
            store.addDocument('t1', 'x');
            store.removeDocument('t1');
            expect(store.hasDocument('t1')).toBe(false);
            expect(store.documentsKeys()).toEqual([]);
        });

        // B5: Object.keys(<a Map>) is always [], so the getter never returned anything
        it('getDocuments lists every document as { title, content }', () => {
            store.mapDocuments([{ title: 'a', content: 'A' }, { title: 'b', content: 'B' }]);
            expect(store.getDocuments).toEqual([{ title: 'a', content: 'A' }, { title: 'b', content: 'B' }]);
        });
    });

    describe('tools', () => {
        const weather = { name: 'weather', description: 'get the weather', parameters: {} };
        const mail = { name: 'mail', description: 'send an email', parameters: {} };

        it('starts empty', () => {
            expect(store.getToolsLength).toBe(0);
            expect(store.getTools).toEqual([]);
        });

        it('adds, finds, reads and removes a tool by key', () => {
            store.addTool('k', weather);
            expect(store.hasTool('k')).toBe(true);
            expect(store.getTool('k')).toEqual(weather);
            expect(store.toolsKeys()).toEqual(['k']);
            store.removeTool('k');
            expect(store.hasTool('k')).toBe(false);
        });

        it('maps tools using their description as key', () => {
            store.mapTools([weather, mail]);
            expect(store.toolsKeys()).toEqual(['get the weather', 'send an email']);
        });

        it('maps tools with a custom key', () => {
            store.mapTools([weather, mail], (t) => t.name);
            expect(store.toolsKeys()).toEqual(['weather', 'mail']);
        });

        it('getTools returns the plain tool objects, not reactive proxies', () => {
            store.mapTools([weather]);
            expect(store.getTools).toEqual([weather]);
            expect(isProxy(store.getTools[0])).toBe(false);
        });

        it('getLength counts tools and documents', () => {
            store.mapTools([weather, mail]);
            store.addDocument('d', 'x');
            expect(store.getLength).toBe(3);
        });
    });

    describe('embeddings', () => {
        it('keeps the embeddings of documents and tools apart', () => {
            store.addDocumentEmbeddings('doc', vec(1, 0));
            store.addToolEmbeddings('tool', vec(0, 1));
            expect(store.getDocumentsEmbeddings()).toEqual([{ key: 'doc', embeddings: vec(1, 0) }]);
            expect(store.getToolsEmbeddings()).toEqual([{ key: 'tool', embeddings: vec(0, 1) }]);
        });
    });

    describe('retrieving by similarity (cosine)', () => {
        beforeEach(() => {
            store.addDocumentEmbeddings('same', vec(1, 0));
            store.addDocumentEmbeddings('close', vec(1, 1));      // 45 degrees, 0.707
            store.addDocumentEmbeddings('orthogonal', vec(0, 1)); // 0
            store.addDocumentEmbeddings('opposite', vec(-1, 0));  // -1
        });

        it('returns the titles that are similar enough, with the default threshold 0.5', () => {
            expect(store.retrieveDocuments(vec(1, 0))).toEqual(['same', 'close']);
        });

        it('a higher threshold is stricter', () => {
            expect(store.retrieveDocuments(vec(1, 0), 0.9)).toEqual(['same']);
        });

        it('the threshold is inclusive', () => {
            expect(store.retrieveDocuments(vec(2, 0), 1)).toEqual(['same']);
        });

        it('the length of the vectors does not matter, the angle does', () => {
            expect(store.retrieveDocuments(vec(100, 0), 0.99)).toEqual(['same']);
        });

        it('a zero vector is similar to nothing', () => {
            expect(store.retrieveDocuments(vec(0, 0), 0.1)).toEqual([]);
        });

        it('throws when the embeddings have a different size (another embeddings model)', () => {
            expect(() => store.retrieveDocuments(vec(1, 0, 0))).toThrow('vecA and vecB size should be equal.');
        });

        it('retrieves tools as the tool objects', () => {
            const weather = { name: 'weather', description: 'get the weather' };
            const mail = { name: 'mail', description: 'send an email' };
            store.mapTools([weather, mail]);
            store.addToolEmbeddings('get the weather', vec(1, 0));
            store.addToolEmbeddings('send an email', vec(0, 1));
            const found = store.retrieveTools(vec(1, 0));
            expect(found).toEqual([weather]);
            expect(isProxy(found[0])).toBe(false);
        });

        it('nothing is retrieved when there are no embeddings', () => {
            const empty = useVectorStore(createPinia());
            expect(empty.retrieveTools(vec(1, 0))).toEqual([]);
        });
    });

    // B6: removing a document/tool left its embeddings behind, so it was still "found" afterwards
    describe('removing what was embedded', () => {
        it('a removed document is no longer retrieved', () => {
            store.addDocument('gone', 'x');
            store.addDocumentEmbeddings('gone', vec(1, 0));
            store.removeDocument('gone');
            expect(store.retrieveDocuments(vec(1, 0))).toEqual([]);
            expect(store.getDocumentsEmbeddings()).toEqual([]);
        });

        it('a removed tool is no longer retrieved (and does not leave an undefined in the result)', () => {
            store.addTool('gone', { name: 'gone', description: 'gone' });
            store.addToolEmbeddings('gone', vec(1, 0));
            store.removeTool('gone');
            expect(store.retrieveTools(vec(1, 0))).toEqual([]);
            expect(store.getToolsEmbeddings()).toEqual([]);
        });

        it('only the removed one goes away', () => {
            store.addDocumentEmbeddings('keep', vec(1, 0));
            store.addDocumentEmbeddings('gone', vec(1, 0));
            store.removeDocument('gone');
            expect(store.retrieveDocuments(vec(1, 0))).toEqual(['keep']);
        });
    });
});
