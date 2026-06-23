package com.tipejos.pet

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.tipejos.pet.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private var pendingCharacter: String? = null

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // Tenga o no permiso de notificación, seguimos: la notificación es deseable pero no bloqueante.
            pendingCharacter?.let { launchPet(it) }
            pendingCharacter = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.btnPermission.setOnClickListener { requestOverlayPermission() }
        b.btnStop.setOnClickListener {
            stopService(Intent(this, PetOverlayService::class.java))
            Toast.makeText(this, "Mascota quitada", Toast.LENGTH_SHORT).show()
            refreshUi()
        }

        b.recycler.layoutManager = GridLayoutManager(this, 3)
        b.recycler.adapter = CharAdapter(CharacterRepo.listCharacters(this)) { name ->
            onCharacterPicked(name)
        }
    }

    override fun onResume() {
        super.onResume()
        refreshUi()
    }

    private fun hasOverlay(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

    private fun refreshUi() {
        val ok = hasOverlay()
        b.permissionCard.visibility = if (ok) View.GONE else View.VISIBLE
        b.hint.text = if (ok)
            "Tocá un personaje para soltarlo en la pantalla."
        else
            "Necesito permiso para mostrar la mascota sobre otras apps."
        b.btnStop.visibility = if (PetOverlayService.running) View.VISIBLE else View.GONE
    }

    private fun requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        }
    }

    private fun onCharacterPicked(name: String) {
        if (!hasOverlay()) {
            Toast.makeText(this, "Primero activá el permiso de overlay", Toast.LENGTH_SHORT).show()
            requestOverlayPermission()
            return
        }
        // Pedir permiso de notificación (Android 13+) antes de arrancar el service.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            pendingCharacter = name
            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            launchPet(name)
        }
    }

    private fun launchPet(name: String) {
        val intent = Intent(this, PetOverlayService::class.java)
            .putExtra(PetOverlayService.EXTRA_CHARACTER, name)
        ContextCompat.startForegroundService(this, intent)
        Toast.makeText(this, "¡Soltaste a $name! Minimizá para verlo.", Toast.LENGTH_SHORT).show()
        b.btnStop.postDelayed({ refreshUi() }, 400)
    }

    // ── Adapter de la grilla ─────────────────────────────────────────────────
    private class CharAdapter(
        private val names: List<String>,
        private val onClick: (String) -> Unit
    ) : RecyclerView.Adapter<CharAdapter.VH>() {

        class VH(v: View) : RecyclerView.ViewHolder(v) {
            val img: ImageView = v.findViewById(R.id.char_thumb)
            val label: TextView = v.findViewById(R.id.char_name)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_character, parent, false)
            return VH(v)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val name = names[position]
            holder.label.text = name
            holder.img.setImageBitmap(CharacterRepo.loadThumb(holder.itemView.context, name))
            holder.itemView.setOnClickListener { onClick(name) }
        }

        override fun getItemCount() = names.size
    }
}
