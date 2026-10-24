import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The unit tests mock transformers.js, kokoro-js and the inference client, so a rename in a new version would pass
// them and break in the browser. This reads the browser build each package ships and checks the names we import are
// still exported, without loading it (the node build of transformers.js needs onnxruntime-node's native binary).
const require = createRequire(import.meta.url);

const packageDir = (name) => {
    for(const dir of require.resolve.paths(name) ?? []){
        const candidate = path.join(dir, name);
        if(existsSync(path.join(candidate, 'package.json'))){
            return candidate;
        }
    }
    throw new Error(`${name} is not installed`);
};

// the file a bundler would take: not the node one
const pick = (node) => {
    if(typeof node === 'string'){
        return node;
    }
    for(const condition of ['browser', 'default', 'import', 'module']){
        if(node[condition]){
            return pick(node[condition]);
        }
    }
    throw new Error('no entry for a browser build');
};

const entryOf = (name) => {
    const dir = packageDir(name);
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const entry = pick(pkg.exports['.'] ?? pkg.exports);
    return { version: pkg.version, source: readFileSync(path.join(dir, entry), 'utf8') };
};

const exportedNames = (source) => {
    const names = new Set();
    for(const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g)){
        for(const part of list.split(',')){
            const [original, alias] = part.trim().split(/\s+as\s+/);
            const name = (alias ?? original).trim();
            if(name){
                names.add(name);
            }
        }
    }
    for(const [, name] of source.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)){
        names.add(name);
    }
    return names;
};

// what the widget imports from each package
const used = {
    '@huggingface/transformers': ['pipeline', 'env', 'TextStreamer', 'mean_pooling', 'RawAudio'],
    'kokoro-js': ['KokoroTTS', 'TextSplitterStream'],
    '@huggingface/inference': ['HfInference'],
    '@huggingface/jinja': ['Template'],
};

describe('the packages still export what the widget imports', () => {
    describe.each(Object.entries(used))('%s', (name, wanted) => {
        const { version, source } = entryOf(name);
        const names = exportedNames(source);

        it.each(wanted)(`exports %s (installed ${version})`, (exported) => {
            expect(names.has(exported), `${name}@${version} no longer exports ${exported}`).toBe(true);
        });
    });

    // HfInference and `.endpoint()` are marked "for backward compatibility only, will remove soon", the remote path uses them
    it('@huggingface/inference already has the class that replaces HfInference', () => {
        expect(exportedNames(entryOf('@huggingface/inference').source).has('InferenceClient')).toBe(true);
    });
});
