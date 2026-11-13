function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>')
        .replace(/"/g, '"').replace(/'/g, ''');
    }