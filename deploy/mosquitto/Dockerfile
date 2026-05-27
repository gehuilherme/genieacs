# Custom mosquitto image that bakes in our config + password file with the
# correct ownership/perms. Bind-mounting the passwd file on Windows breaks
# because mosquitto 2.x refuses files owned by uid 0 with loose perms.
FROM eclipse-mosquitto:2

COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY passwd /mosquitto/config/passwd

RUN chown mosquitto:mosquitto /mosquitto/config/passwd \
    && chmod 0640 /mosquitto/config/passwd
