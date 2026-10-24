/**
 * @brief Manages cache operations for a specified cache name.
 * 
 * This class handles the initialization of the cache, retrieval of cached items, 
 * and deletion of both hosts and individual files from the cache.
 */
/**
 * @brief the host of a cached url: scheme and authority (`https://huggingface.co`, `http://localhost:8080`).
 * @param {string} url
 * @returns {string}
 */
const hostOf = (url) => url.split("/").slice(0, 3).join("/");
/**
 * @brief the file name of a cached url: its last segment.
 * @param {string} url
 * @returns {string}
 */
const fileOf = (url) => url.split("/").pop();

export class CacheManager{
    /**
     * @param {string} cacheName - The name of the cache to manage.
     */
    constructor(cacheName){
        this.cacheRequests = [];
        this.cacheHosts = new Map();
        this.cacheName = cacheName;
        this.isInitialized = false;
        this.initPromise = null;
        this.initCache();
    }
    /**
     * @brief Initializes the cache and populates cacheRequests and cacheHosts.
     *
     * This method opens the specified cache, retrieves all cache requests,
     * and organizes the cached files by their respective hosts.
     *
     * This method is called automatically during the construction of the
     * CacheManager instance and will only run once: calls made while it is running wait for the same job.
     */
    initCache(){
        if(this.isInitialized){
            return Promise.resolve();
        }
        if(!this.initPromise){
            this.initPromise = this.#readCache().finally(() => {
                this.initPromise = null;
            });
        }
        return this.initPromise;
    }
    async #readCache(){
        try{
            const currentCache = await caches.open(this.cacheName);
            if(currentCache){
                this.isInitialized = true;
                this.cacheRequests = await currentCache.keys();
                for(const req of this.cacheRequests){
                    const host = hostOf(req.url);
                    const filename = fileOf(req.url);
                    if(this.cacheHosts.has(host)){
                        const files = this.cacheHosts.get(host);
                        if (!files.includes(filename)) {
                            files.push(filename);
                        }
                    }else{
                        this.cacheHosts.set(host, [filename]);
                    }
                }
            }
        }catch(e){
            console.error("Failed to initialize cache:", e);
        }
    }
    /**
     * @brief it reloads the cache
     */
    async reload(){
        await this.initPromise;
        this.isInitialized = false;
        this.cacheRequests = [];
        this.cacheHosts = new Map();
        await this.initCache();
    }
    /**
     * @brief return how many hosts are in this cache.
     * @returns number
     */
    size(){
        return this.cacheHosts.size;
    }
    /**
     * @brief Deletes all cached entries for a specified host.
     *
     * @param {string} host - The host whose cached entries should be deleted.
     */
    async deleteHost(host){
        try{
            const currentCache = await caches.open(this.cacheName);
            if(currentCache && this.cacheHosts.has(host)){
                for(const req of this.cacheRequests.filter(r => hostOf(r.url) === host)){
                    await currentCache.delete(req);
                    this.cacheRequests = this.cacheRequests.filter(r => r !== req);
                }
                this.cacheHosts.delete(host);
            }
        }catch(e){
            console.error("Failed to delete host from cache:", e);
        }
    }
    /**
     * @brief Deletes multiple files from a specified host.
     *
     * The list shows one name per host, so a name is deleted from every model of the host that has it.
     *
     * @param {string} host - The host from which to delete the files.
     * @param {string[]} filenames - An array of filenames to delete.
     */
    async deleteFilesFrom(host, filenames) {
        try{
            const currentCache = await caches.open(this.cacheName);
            if(currentCache){
                for(const filename of filenames){
                    const reqsToDelete = this.cacheRequests.filter(req =>
                        hostOf(req.url) === host && fileOf(req.url) === filename
                    );
                    if(reqsToDelete.length){
                        for(const req of reqsToDelete){
                            await currentCache.delete(req);
                            this.cacheRequests = this.cacheRequests.filter(r => r !== req);
                        }
                        const files = this.cacheHosts.get(host) || [];
                        this.cacheHosts.set(host, files.filter(file => file !== filename));
                        if(this.cacheHosts.get(host).length === 0){
                            this.cacheHosts.delete(host);
                        }
                    }else{
                        console.warn(`File ${filename} not found in cache for host ${host}.`);
                    }
                }
            }
        }catch (e){
            console.error(`Failed to delete files from host ${host}:`, e);
        }
    }
    /**
     * @brief check if has all files inside host.
     * @param {String} host
     * @param {Array} files
     * @returns Boolean
     */
    hasFiles(host, files){
        if(!this.cacheHosts.has(host)){
            return false;
        }
        for(const file of files){
            if(!this.cacheHosts.get(host).find( f => f === file)){
                return false;
            }
        }
        return true;
    }
}

export default { CacheManager };
