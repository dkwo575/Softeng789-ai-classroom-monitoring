package io.github.huijingmen.softeng789.classroommonitoring.auth;

import io.github.huijingmen.softeng789.classroommonitoring.service.SessionAuthService;
import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

@Configuration
public class BrowserSecurityConfiguration {
    @Bean
    UserDetailsService noGeneratedLoginAccounts() {
        return username -> { throw new UsernameNotFoundException("Use the application login endpoint."); };
    }

    @Bean
    CookieCsrfTokenRepository csrfTokens(BrowserSessionCookies cookies) {
        var repository = new CookieCsrfTokenRepository();
        repository.setCookieName(cookies.csrfName());
        repository.setHeaderName("X-CSRF-TOKEN");
        repository.setCookieCustomizer(cookie -> cookie.httpOnly(true).secure(cookies.secure())
                .sameSite("Strict").path("/"));
        return repository;
    }

    @Bean
    SecurityFilterChain browserSecurity(HttpSecurity http, SessionAuthService sessions,
            BrowserSessionCookies cookies, CookieCsrfTokenRepository csrfTokens) throws Exception {
        return http
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .requestCache(cache -> cache.disable())
                .formLogin(form -> form.disable()).httpBasic(basic -> basic.disable()).logout(logout -> logout.disable())
                .cors(cors -> {})
                .csrf(csrf -> csrf.csrfTokenRepository(csrfTokens).ignoringRequestMatchers("/api/ai/**"))
                .addFilterBefore(new BrowserSessionFilter(sessions, cookies), AnonymousAuthenticationFilter.class)
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/health", "/actuator/health", "/actuator/health/**",
                                "/api/classes/public", "/api/auth/csrf", "/api/auth/capabilities", "/api/auth/registration-options",
                                "/api/students/*/face-enrollment/photo",
                                "/api/students/*/face-enrollment/captures/*/photo",
                                "/api/progress-reports/*/photo").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/logout", "/api/auth/register/student",
                                "/api/auth/registration-capture-check",
                                "/api/auth/register/teacher", "/api/auth/account-links", "/api/auth/account-links/inspect",
                                "/api/auth/account-links/reset-password", "/api/auth/account-links/confirm-contact").permitAll()
                        // Existing machine-key interceptor remains mandatory for all these routes.
                        .requestMatchers("/api/ai/**").permitAll()
                        .requestMatchers("/actuator/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint((request, response, exception) -> {
                            response.setStatus(401);
                            response.setContentType("application/problem+json");
                            response.getWriter().write("{\"detail\":\"Sign in required.\"}");
                        })
                        .accessDeniedHandler((request, response, exception) -> {
                            response.setStatus(403);
                            response.setCharacterEncoding("UTF-8");
                            response.setContentType("application/problem+json");
                            boolean csrfFailure = exception instanceof org.springframework.security.web.csrf.CsrfException;
                            response.getWriter().write(csrfFailure
                                    ? "{\"code\":\"CSRF_INVALID\",\"detail\":\"Request protection expired. Please try again.\"}"
                                    : "{\"code\":\"ACCESS_DENIED\",\"detail\":\"You do not have access to this operation.\"}");
                        }))
                .build();
    }
}
