/**
 * Conversation Store with Braille Compaction
 * 
 * Stores conversation history in braille-encoded format for efficient storage
 * and automatic context management.
 */

const fs = require('fs').promises;
const path = require('path');
const { toBraille, fromBraille } = require('./braille');

class ConversationStore {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.join(__dirname, '../data/conversations');
    this.maxSize = options.maxSize || 100000; // Max chars before compaction
    this.compactionThreshold = options.compactionThreshold || 0.7; // Compact at 70% of max
    this.conversations = new Map();
    this.initialized = false;
  }

  async initialize() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      
      // Load existing conversations
      const files = await fs.readdir(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.braille')) {
          const id = file.replace('.braille', '');
          const content = await fs.readFile(path.join(this.storageDir, file), 'utf8');
          this.conversations.set(id, {
            id,
            messages: this.decompactConversation(content),
            lastAccessed: Date.now()
          });
        }
      }
      
      this.initialized = true;
      return true;
    } catch (e) {
      console.error('Failed to initialize conversation store:', e);
      return false;
    }
  }

  compactConversation(messages) {
    // Convert to condensed format
    const condensed = messages.map(m => ({
      r: m.role.charAt(0), // u/a/s for user/assistant/system
      c: m.content,
      t: m.timestamp
    }));
    
    // Convert to string and encode as braille
    return toBraille(JSON.stringify(condensed));
  }

  decompactConversation(brailleData) {
    try {
      const condensed = JSON.parse(fromBraille(brailleData));
      
      // Expand condensed format
      return condensed.map(m => ({
        role: m.r === 'u' ? 'user' : m.r === 'a' ? 'assistant' : 'system',
        content: m.c,
        timestamp: m.t
      }));
    } catch (e) {
      console.error('Failed to decompact conversation:', e);
      return [];
    }
  }

  async saveConversation(id, messages) {
    const compacted = this.compactConversation(messages);
    await fs.writeFile(
      path.join(this.storageDir, `${id}.braille`),
      compacted,
      'utf8'
    );
    
    this.conversations.set(id, {
      id,
      messages,
      lastAccessed: Date.now()
    });
  }

  async getConversation(id) {
    const conversation = this.conversations.get(id);
    if (conversation) {
      conversation.lastAccessed = Date.now();
      return conversation.messages;
    }
    
    // Try loading from disk
    try {
      const content = await fs.readFile(
        path.join(this.storageDir, `${id}.braille`),
        'utf8'
      );
      const messages = this.decompactConversation(content);
      this.conversations.set(id, {
        id,
        messages,
        lastAccessed: Date.now()
      });
      return messages;
    } catch (e) {
      return null;
    }
  }

  async addMessage(id, message) {
    const messages = (await this.getConversation(id)) || [];
    messages.push({
      ...message,
      timestamp: message.timestamp || Date.now()
    });
    
    // Check if we need to compact
    if (JSON.stringify(messages).length > this.maxSize * this.compactionThreshold) {
      // Simple compaction: keep last N messages that fit within maxSize
      while (JSON.stringify(messages).length > this.maxSize && messages.length > 1) {
        messages.shift();
      }
    }
    
    await this.saveConversation(id, messages);
    return messages;
  }

  async deleteConversation(id) {
    this.conversations.delete(id);
    try {
      await fs.unlink(path.join(this.storageDir, `${id}.braille`));
      return true;
    } catch (e) {
      return false;
    }
  }

  async getAllConversations() {
    const conversations = [];
    for (const [id, conv] of this.conversations) {
      conversations.push({
        id,
        messageCount: conv.messages.length,
        lastAccessed: conv.lastAccessed
      });
    }
    return conversations;
  }

  getStats() {
    const stats = {
      totalConversations: this.conversations.size,
      totalMessages: 0,
      averageMessagesPerConversation: 0,
      oldestAccess: Infinity,
      newestAccess: 0
    };

    for (const conv of this.conversations.values()) {
      stats.totalMessages += conv.messages.length;
      stats.oldestAccess = Math.min(stats.oldestAccess, conv.lastAccessed);
      stats.newestAccess = Math.max(stats.newestAccess, conv.lastAccessed);
    }

    if (stats.totalConversations > 0) {
      stats.averageMessagesPerConversation = 
        stats.totalMessages / stats.totalConversations;
    }

    return stats;
  }
}

module.exports = {
  ConversationStore
};