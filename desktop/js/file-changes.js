// File change tracking module
export class FileChangeTracker {
    constructor() {
        this.changes = new Map();
        this.pollInterval = null;
    }

    async startTracking(path) {
        // Start watching the directory
        try {
            await fetch('/files/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
        } catch (err) {
            console.error('Failed to start file tracking:', err);
        }

        // Poll for changes every 2 seconds
        this.pollInterval = setInterval(async () => {
            await this.checkChanges();
        }, 2000);
    }

    stopTracking() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    async checkChanges() {
        try {
            const response = await fetch('/files/changes');
            const changes = await response.json();
            
            // Update UI for changed files
            this.changes = new Map(Object.entries(changes));
            this.updateUI();
        } catch (err) {
            console.error('Failed to check file changes:', err);
        }
    }

    updateUI() {
        // Update file tree items
        const fileItems = document.querySelectorAll('.file-item');
        fileItems.forEach(item => {
            const filePath = item.dataset.path;
            const change = this.changes.get(filePath);
            
            item.classList.remove('changed');
            item.classList.remove('file-status-modified', 'file-status-added', 'file-status-untracked', 'file-status-deleted');
            
            if (change) {
                item.classList.add('changed');
                item.classList.add(`file-status-${change.status}`);
            }
        });
    }

    getFileStatus(path) {
        return this.changes.get(path);
    }
}

// Export singleton instance
export const fileChangeTracker = new FileChangeTracker();