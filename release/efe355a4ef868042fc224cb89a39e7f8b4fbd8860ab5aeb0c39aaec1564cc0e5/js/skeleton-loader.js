(function() {

  /* ── Build message skeleton HTML ── */
  function _buildMsgSkeletons(count) {
    const patterns = [
      { side:"other", name:true,  size:"medium" },
      { side:"me",    name:false, size:"short"  },
      { side:"other", name:false, size:"long"   },
      { side:"me",    name:false, size:"medium" },
      { side:"other", name:true,  size:"short"  },
      { side:"me",    name:false, size:"long"   },
      { side:"other", name:false, size:"medium" },
      { side:"me",    name:false, size:"short"  },
      { side:"other", name:true,  size:"long"   },
      { side:"me",    name:false, size:"medium" },
    ];
    let html = '<div class="chat-skel-wrap">';
    for (let i = 0; i < count; i++) {
      const p = patterns[i % patterns.length];
      html += `
        <div class="msg-skel-row ${p.side}">
          ${p.side === "other" ? `<div class="msg-skel-avatar skel-base"></div>` : ""}
          <div class="msg-skel-group">
            ${p.name && p.side === "other" ? `<div class="msg-skel-name skel-base"></div>` : ""}
            <div class="msg-skel-bubble ${p.size} ${p.side}-bubble skel-base"></div>
            <div class="msg-skel-meta skel-base"></div>
          </div>
          ${p.side === "me" ? `<div class="msg-skel-avatar skel-base"></div>` : ""}
        </div>`;
    }
    html += '</div>';
    return html;
  }

  /* ── Build members list skeletons ── */
  function _buildMemberSkeletons(count) {
    let html = "";
    for (let i = 0; i < count; i++) {
      html += `
        <div class="member-skel-item">
          <div class="member-skel-avatar skel-base"></div>
          <div class="member-skel-info">
            <div class="member-skel-name skel-base"></div>
            <div class="member-skel-preview skel-base"></div>
          </div>
        </div>`;
    }
    return html;
  }

  /* ── Expose globally ── */
  window._buildMsgSkeletons    = _buildMsgSkeletons;
  window._buildMemberSkeletons = _buildMemberSkeletons;

})();
    
