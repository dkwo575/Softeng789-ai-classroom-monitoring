package io.github.huijingmen.softeng789.classroommonitoring.auth.accountlinks;

import java.net.URI;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Commits a no-resend claim before SMTP. Uncertain sends are never automatically replayed. */
@Service
public class AccountLinkDelivery {
    private final AccountLinkRepository links;
    private final AccountLinkTargets targets;
    private final String origin;
    public AccountLinkDelivery(AccountLinkRepository links, AccountLinkTargets targets,
            @Value("${app.public-origin:http://localhost:5173}") String origin) {
        this.links = links; this.targets = targets;
        // A copied local .env may explicitly leave PUBLIC_APP_ORIGIN empty. Production separately
        // rejects that via ProductionBrowserPolicy; disabled/local work uses loopback, never Host.
        String configuredOrigin = origin == null || origin.isBlank() ? "http://localhost:5173" : origin;
        URI uri = URI.create(configuredOrigin);
        if (uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null
                || uri.getRawFragment() != null || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                || !("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme())
                && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()))))) {
            throw new IllegalArgumentException("Account links require a canonical HTTPS public origin (loopback HTTP only for local work).");
        }
        this.origin = configuredOrigin;
    }

    public record Mail(String email, AccountLinkPurpose purpose, String link) {
        @Override public String toString() { return "AccountLinkMail[redacted]"; }
    }

    @Transactional
    public Mail claimNext() {
        var pending = links.nextRequests(PageRequest.of(0, 1));
        if (pending.isEmpty()) return null;
        var row = pending.getFirst();
        var target = targets.resolve(row);
        if (!Instant.now().isBefore(row.getExpiresAt()) || target == null) { row.discard(); return null; }
        String token = AccountLinkSecrets.generate();
        row.dispatch(AccountLinkSecrets.digest(token), target.id(), target.role(),
                AccountLinkSecrets.fingerprint(target.passwordHash()), Instant.now());
        // The fragment is not transmitted to the web server, proxies or HTTP referrers.
        return new Mail(row.getEmail(), row.getPurpose(), activationUrl(token));
    }

    public String activationUrl(String token) { return origin + "/#account-link=" + token; }

    @Transactional
    public int cleanup() { return links.deleteExpired(Instant.now()); }
}
