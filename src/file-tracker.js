const { watch } = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class FileTracker {
    constructor() {
        this.watchedDirs = new Set();
        this.changedFiles = new Map(); // path -> {status, timestamp}
        this.subscribers = new Set();
    }

    async getGitStatus() {
        try {
            const { stdout } = await execAsync('git status --porcelain');
            const changes = new Map();
            
            stdout.split('\n').filter(Boolean).forEach(line => {
                const [status, path] = [line.slice(0, 2).trim(), line.slice(3)];
                changes.set(path, {
                    status: this.parseGitStatus(status),
                    timestamp: Date.now()
                });
            });

            return changes;
        } catch (err) {
            console.warn('Not a git repository or git not available');
            return new Map();
        }
    }

    parseGitStatus(code) {
        switch(code) {
            case 'M': return 'modified';
            case 'A': return 'added';
            case '??': return 'untracked';
            case 'D': return 'deleted';
            default: return 'unknown';
        }
    }

    watchDirectory(dir) {
        if (this.watchedDirs.has(dir)) return;

        const watcher = watch(dir, { recursive: true }, async (eventType, filename) => {
            if (!filename) return;

            // Update changed files
            this.changedFiles.set(filename, {
                status: 'modified',
                timestamp: Date.now()
            });

            // Get git status for more accurate tracking
            const gitChanges = await this.getGitStatus();
            this.changedFiles = new Map([...this.changedFiles, ...gitChanges]);

            // Notify subscribers
            this.notifySubscribers();
        });

        this.watchedDirs.add(dir);
    }

    subscribe(callback) {
        this.subscribers.add(callback);
    }

    unsubscribe(callback) {
        this.subscribers.delete(callback);
    }

    notifySubscribers() {
        const changes = Object.fromEntries(this.changedFiles);
        this.subscribers.forEach(callback => callback(changes));
    }
}

module.exports = new FileTracker();