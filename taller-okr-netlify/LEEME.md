# Taller de OKRs — Versión Netlify (sin Supabase)

Todo vive en **Netlify**: la página, el servidor (función `/api`) y los datos (**Netlify Blobs**).
No necesitas ninguna otra cuenta además de **GitHub** (para subir los archivos) y **Netlify**.

```
taller-okr-netlify/
├── public/index.html          ← la aplicación
├── netlify/functions/api.mjs  ← el servidor
├── netlify/lib/core.mjs       ← reglas de seguridad, vigencias y datos
├── netlify.toml               ← configuración de Netlify
└── package.json               ← dependencia @netlify/blobs
```

---

## PARTE 1 · Subir los archivos a GitHub (10 min, una sola vez)

1. Crea una cuenta gratis en **github.com** (si no tienes).
2. Arriba a la derecha: **＋ → New repository**.
   - Repository name: `taller-okr`
   - Elige **Private** (privado).
   - Clic en **Create repository**.
3. En la página que aparece, clic en el enlace **"uploading an existing file"**.
4. Abre la carpeta `taller-okr-netlify` en tu computadora, **selecciona TODO su contenido** (las carpetas `public` y `netlify`, y los archivos `netlify.toml`, `package.json`, `LEEME.md`) y **arrástralo** a la página de GitHub.
   ⚠️ Arrastra el *contenido*, no la carpeta `taller-okr-netlify` en sí. En GitHub deben verse `public/`, `netlify/`, `netlify.toml` y `package.json` en la raíz.
5. Abajo, clic en **Commit changes**.

## PARTE 2 · Conectar Netlify (10 min, una sola vez)

6. Entra a **app.netlify.com** → **Add new site → Import an existing project**.
7. Elige **GitHub**, autoriza a Netlify y selecciona el repositorio `taller-okr`.
8. En la configuración que aparece **no cambies nada** (Netlify lee `netlify.toml`: carpeta `public`, funciones en `netlify/functions`). Clic en **Deploy**.
9. Ve a **Site configuration → Environment variables → Add a variable** y crea estas **3 variables**:

   | Key | Value |
   |---|---|
   | `ADMIN_EMAIL` | tu correo (será tu usuario de super administrador) |
   | `ADMIN_PASSWORD` | tu contraseña de super administrador (larga y segura) |
   | `OKR_SECRET` | una frase larga al azar, mínimo 32 caracteres (ej. `Tigre-OKR-2027-x9Lq...`). No la compartas. |

10. Ve a **Deploys → Trigger deploy → Deploy site** (las variables solo aplican después de volver a publicar).
11. Opcional: **Site configuration → Change site name** → por ejemplo `taller-okr-cck` → tu liga queda `https://taller-okr-cck.netlify.app`.

## PARTE 3 · Primera entrada

12. Abre tu liga. En **"Soy facilitador"** entra con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
    - Si aparece un aviso amarillo de "Falta configurar el servidor", revisa el paso 9 y vuelve a hacer el paso 10.
    - Si aparece el cuadro "Modo demo", la función no se publicó: revisa que `netlify/` y `netlify.toml` estén en la raíz del repositorio (paso 4).

## PARTE 4 · Dar de alta un cliente (2 min, desde tu página)

13. **＋ Nuevo cliente** → nombre y **vigencia desde / hasta**.
14. En su tarjeta → **👤 Usuario y contraseña** → su correo → **🎲 Generar** (o escribe una) → **Guardar**.
15. Envía al cliente: **liga + correo + contraseña**.

Desde la tarjeta del cliente también puedes:
- **＋3 meses / ＋1 año** → renovar vigencia.
- **⏸️ Suspender** → cortar el acceso de inmediato.
- **👤 Usuario y contraseña** → cambiar contraseña (mismo correo, nueva contraseña) o quitar un usuario (✕). Al cambiarla, su sesión anterior se cierra sola.
- **📊 Reporte** → resumen de todos sus talleres (imprimir/PDF y Excel).
- **🗑️ Eliminar** → borra el cliente, sus talleres, ideas, participantes **y sus usuarios** (pide respaldo y escribir el nombre).

## Qué ve cada quien (lo controla el servidor, no solo la pantalla)
- **Tú (super admin)**: todos los clientes, usuarios, vigencias, talleres y reportes.
- **Cliente**: solo su empresa, sus talleres, ideas, objetivos y su reporte.
- **Participantes**: entran con el código del taller desde su celular (sin cuenta), solo mientras la licencia esté vigente.
- **Vigencia vencida o suspendido**: el cliente ve sus talleres en solo lectura; no edita, no crea, y los participantes no entran.

## Actualizar la aplicación en el futuro
En GitHub abre el repositorio → entra a la carpeta del archivo → **Add file → Upload files** → arrastra el archivo nuevo (mismo nombre) → **Commit changes**. Netlify publica solo en 1–2 minutos. Tus datos **no se borran** al actualizar.

## Cambiar tu contraseña de super admin
Netlify → **Environment variables** → edita `ADMIN_PASSWORD` → **Deploys → Trigger deploy**.
⚠️ Si cambias `OKR_SECRET`, todos tendrán que volver a iniciar sesión (los datos no se pierden).

## Respaldos
Los datos quedan guardados en Netlify Blobs de tu sitio. Para tener copia en tu computadora usa **📊 Reporte → Excel detalle** de cada cliente (recomendado al cierre de cada mes).

## Probar sin internet
Si abres `public/index.html` con doble clic, funciona en **modo demo** (datos solo en ese navegador) con las cuentas de prueba `super@demo.com`, `admin@demo.com`, `vencido@demo.com` (contraseña `demo`).
